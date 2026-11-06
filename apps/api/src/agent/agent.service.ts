import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { BasicAgentConfiguration } from "@townbase/agent-core";
import { Prisma } from "@townbase/database";
import {
  AuthService,
  type AdministratorContext,
  type AuthTransaction,
} from "../auth/auth.service";
import {
  ANSWER_MODELS,
  DEFAULT_EXECUTION,
  digest,
  validRequestId,
} from "../model-integration/model-policy";
import {
  AGENT_LIMITS,
  canonicalAgent,
  validAgentConfiguration,
} from "./agent-policy";

type Agent = Prisma.BasicAgentGetPayload<Record<string, never>>;
@Injectable()
export class AgentService {
  constructor(private readonly auth: AuthService) {}
  private where(c: AdministratorContext) {
    return {
      installationId: c.installationId,
      ownerAdministratorId: c.administratorId,
    };
  }
  private configuration(row: Agent): BasicAgentConfiguration {
    const config = {
      name: row.name,
      purpose: row.purpose,
      instructions: row.instructions,
      terminology: row.terminology,
      sourceSelection: row.sourceSelection,
      sourceOriginalIds: row.sourceOriginalIds,
    };
    if (!validAgentConfiguration(config))
      throw new Error("Invalid stored Agent configuration");
    return canonicalAgent(config);
  }
  private view(row: Agent) {
    return {
      id: row.id,
      revision: row.revision,
      ...this.configuration(row),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
  private async snapshotIn(tx: AuthTransaction, c: AdministratorContext) {
    const row = await tx.basicAgent.findFirst({ where: this.where(c) });
    const execution = await tx.modelExecutionSettings.findUnique({
      where: { installationId: c.installationId },
    });
    const model = execution?.answerModel ?? DEFAULT_EXECUTION.answerModel;
    if (!ANSWER_MODELS.includes(model as (typeof ANSWER_MODELS)[number]))
      throw new Error("Unsupported stored answer model");
    return {
      agent: row ? this.view(row) : null,
      answerModel: model,
      supportedAnswerModels: ANSWER_MODELS,
      modelSettingsPath: "/settings/model-integration/execution",
      limits: AGENT_LIMITS,
    };
  }
  async snapshot(token: string | undefined, c: AdministratorContext) {
    const result = await this.auth.authorizedOperation(
      token,
      c,
      async (tx, fresh) => ({ value: await this.snapshotIn(tx, fresh) }),
    );
    if (!result.ok) throw new UnauthorizedException({ code: "unauthorized" });
    return result.value;
  }
  configure(
    token: string | undefined,
    password: unknown,
    c: AdministratorContext,
    expectedRevision: number,
    input: BasicAgentConfiguration,
  ) {
    if (
      !validAgentConfiguration(input) ||
      !Number.isInteger(expectedRevision) ||
      expectedRevision < 0 ||
      expectedRevision >= 2147483647
    )
      throw new BadRequestException({ code: "invalid_request" });
    const config = canonicalAgent(input);
    return this.auth.sensitiveOperation(
      token,
      password,
      c,
      async (tx, fresh) => {
        const row = await tx.basicAgent.findFirst({ where: this.where(fresh) });
        // Same auth-state lock as source mutation, logout and model settings writes.
        if ((row?.revision ?? 0) !== expectedRevision)
          throw new ConflictException({ code: "agent_changed" });
        await this.assertOwnedSources(tx, fresh, config.sourceOriginalIds);
        if (row && digest(this.configuration(row)) === digest(config))
          return this.snapshotIn(tx, fresh);
        const data = {
          ...config,
          sourceOriginalIds: [...config.sourceOriginalIds],
          terminology: config.terminology.map((t) => ({ ...t })),
        };
        if (row)
          await tx.basicAgent.update({
            where: { installationId: fresh.installationId },
            data: { ...data, revision: row.revision + 1 },
          });
        else
          await tx.basicAgent.create({
            data: { ...data, ...this.where(fresh), id: randomUUID() },
          });
        await tx.installationAuditEvent.create({
          data: {
            installationId: fresh.installationId,
            actorType: "administrator",
            actorAdministratorId: fresh.administratorId,
            action: "agent_settings_changed",
            outcome: "succeeded",
            requestId: randomUUID(),
          },
        });
        return this.snapshotIn(tx, fresh);
      },
    );
  }
  private async assertOwnedSources(
    tx: AuthTransaction,
    c: AdministratorContext,
    ids: readonly string[],
  ) {
    if (!ids.length) return;
    const count = await tx.fileOriginal.count({
      where: {
        ...this.where(c),
        id: { in: [...ids] },
        deletedAt: null,
        excludedAt: null,
      },
    });
    if (count !== ids.length)
      throw new ConflictException({ code: "agent_source_unavailable" });
  }
  // Internal E02 boundary: a source preference never grants access. The caller must
  // also use D05 assertFileSourcesCurrent for exact version/chunk/scope at admission/publication.
  async assertSourceSelection(
    tx: AuthTransaction,
    c: AdministratorContext,
    expected: { id: string; revision: number },
    originalIds: readonly string[],
  ) {
    if (
      !Array.isArray(originalIds) ||
      !originalIds.length ||
      originalIds.length > 20 ||
      Object.keys(originalIds).length !== originalIds.length ||
      !Array.from(originalIds).every(validRequestId)
    )
      throw new BadRequestException({ code: "invalid_request" });
    const row = await tx.basicAgent.findFirst({ where: this.where(c) });
    if (!row || row.id !== expected.id || row.revision !== expected.revision)
      throw new ConflictException({ code: "agent_changed" });
    const config = this.configuration(row);
    const ids = [...new Set(originalIds.map((id) => id.toLowerCase()))];
    if (
      config.sourceSelection === "selected" &&
      ids.some((id) => !config.sourceOriginalIds.includes(id))
    )
      throw new ConflictException({ code: "agent_source_unavailable" });
    await this.assertOwnedSources(tx, c, ids);
  }
}
