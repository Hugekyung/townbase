import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  AuthService,
  type AdministratorContext,
  type AuthTransaction,
} from "../auth/auth.service";
import { DeploymentDatabase } from "../deployment/deployment-database";
import { CredentialVault, type CredentialPurpose } from "./credential-vault";
import {
  DEFAULT_TRANSFERS,
  FIXED_EMBEDDING,
  OPENAI_ENDPOINTS,
  inspectTransfer,
  type TransferPurpose,
} from "./transfer-policy";
import {
  ANSWER_MODELS,
  DEFAULT_EXECUTION,
  PRICE_VERSION,
  ModelCallError,
  cost,
  digest,
  inputBound,
  parseBudget,
  reservation,
  rates,
  usd,
  validExecution,
  validRequestId,
  type ExecutionSettings,
  type AnswerModel,
  type Reasoning,
} from "./model-policy";
import {
  OpenAIProvider,
  type ProviderResult,
  type ProviderRequest,
} from "./openai-provider";

type Tx = AuthTransaction;
export type CallInput = {
  requestId: string;
  purpose: TransferPurpose;
  input: string;
  fileNames?: readonly string[];
};
export const CONNECTION_INPUT = "Townbase connection test. Reply with OK.";
const TIMEOUT_MS = 90000;
@Injectable()
export class ModelExecutionService {
  constructor(
    private readonly database: DeploymentDatabase,
    private readonly auth: AuthService,
    private readonly vault: CredentialVault,
    private readonly provider: OpenAIProvider,
  ) {}
  private async settings(
    tx: Pick<Tx, "modelExecutionSettings">,
    installationId: string,
  ): Promise<ExecutionSettings> {
    const row = await tx.modelExecutionSettings.findUnique({
      where: { installationId },
    });
    return row == null
      ? { ...DEFAULT_EXECUTION }
      : {
          answerModel: row.answerModel as AnswerModel,
          reasoning: row.reasoning as Reasoning,
          inputTokenLimit: row.inputTokenLimit,
          outputTokenLimit: row.outputTokenLimit,
          priceVersion: row.priceVersion,
          monthlyBudgetUsd:
            row.monthlyBudgetNanoUsd == null
              ? null
              : usd(row.monthlyBudgetNanoUsd),
        };
  }
  private async lock(tx: Tx, installationId: string) {
    const rows = await tx.$queryRaw<
      Array<{ id: string }>
    >`SELECT id FROM "Installation" WHERE id=${installationId} FOR UPDATE`;
    if (rows.length !== 1)
      throw new ModelCallError("installation_unavailable", 503);
  }
  async configure(
    token: string | undefined,
    password: unknown,
    context: AdministratorContext,
    value: ExecutionSettings,
  ) {
    if (!validExecution(value))
      throw new ModelCallError("invalid_model_settings");
    const budget = parseBudget(value.monthlyBudgetUsd);
    return this.auth.sensitiveOperation(
      token,
      password,
      context,
      async (tx, fresh) => {
        await this.lock(tx, fresh.installationId);
        const current = await this.settings(tx, fresh.installationId);
        const normalized = {
          ...value,
          monthlyBudgetUsd: budget == null ? null : usd(budget),
        };
        if (digest(current) === digest(normalized))
          return { settings: current };
        const data = {
          answerModel: value.answerModel,
          reasoning: value.reasoning,
          inputTokenLimit: value.inputTokenLimit,
          outputTokenLimit: value.outputTokenLimit,
          monthlyBudgetNanoUsd: budget,
          priceVersion: value.priceVersion,
        };
        await tx.modelExecutionSettings.upsert({
          where: { installationId: fresh.installationId },
          create: { installationId: fresh.installationId, ...data },
          update: data,
        });
        await tx.installationAuditEvent.create({
          data: {
            installationId: fresh.installationId,
            actorType: "administrator",
            actorAdministratorId: fresh.administratorId,
            action: "model_execution_settings_changed",
            outcome: "succeeded",
            requestId: randomUUID(),
          },
        });
        return { settings: normalized };
      },
    );
  }
  private async exposure(
    tx: Pick<Tx, "modelCall">,
    installationId: string,
    monthStart: Date,
  ) {
    const aggregate = await tx.modelCall.aggregate({
      where: {
        installationId,
        OR: [{ createdAt: { gte: monthStart } }, { chargedNanoUsd: null }],
      },
      _sum: { chargedNanoUsd: true },
    });
    const held = await tx.modelCall.aggregate({
      where: { installationId, chargedNanoUsd: null },
      _sum: { reservedNanoUsd: true },
    });
    return {
      charged: aggregate._sum.chargedNanoUsd ?? 0n,
      held: held._sum.reservedNanoUsd ?? 0n,
    };
  }
  private month(now: Date) {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  }
  async snapshot(context: AdministratorContext) {
    return this.database.prisma.$transaction(
      async (tx) => {
        const settings = await this.settings(tx, context.installationId);
        const [clockRow] = await tx.$queryRaw<
          Array<{ now: Date }>
        >`SELECT clock_timestamp() AS now`;
        if (!clockRow) throw new ModelCallError("clock_unavailable", 503);
        const now = clockRow.now;
        const exposure = await this.exposure(
          tx,
          context.installationId,
          this.month(now!),
        );
        const limit =
          settings.monthlyBudgetUsd == null
            ? null
            : parseBudgetDecimal(settings.monthlyBudgetUsd);
        return {
          settings,
          priceVersion: PRICE_VERSION,
          pricing: [...ANSWER_MODELS, FIXED_EMBEDDING.model].map((model) => ({
            model,
            usdPerMillionTokens: Object.fromEntries(
              Object.entries(rates(model)).map(([name, rate]) => [
                name,
                usd(rate * 1000000n),
              ]),
            ),
          })),
          period: "UTC calendar month",
          chargedUsd: usd(exposure.charged),
          heldUsd: usd(exposure.held),
          warning80:
            limit != null &&
            (exposure.charged + exposure.held) * 100n >= limit * 80n,
          blocked:
            limit == null ||
            settings.priceVersion !== PRICE_VERSION ||
            exposure.charged + exposure.held >= limit,
        };
      },
      { isolationLevel: "RepeatableRead" },
    );
  }
  async connection(
    context: AdministratorContext,
    purpose: CredentialPurpose,
    credentialTag: string,
  ) {
    const settings = await this.settings(
      this.database.prisma,
      context.installationId,
    );
    const row = await this.database.prisma.modelCall.findFirst({
      where: {
        installationId: context.installationId,
        ownerAdministratorId: context.administratorId,
        purpose: `check_${purpose}`,
        credentialTag,
        configurationDigest: digest(settings),
      },
      orderBy: { createdAt: "desc" },
    });
    return row == null
      ? "not_checked"
      : row.status === "succeeded"
        ? "verified"
        : row.status === "dispatching" && row.deadlineAt.getTime() > Date.now()
          ? "checking"
          : "failed";
  }
  private view(row: {
    requestId: string;
    purpose: string;
    model: string;
    status: string;
    reservedNanoUsd: bigint;
    chargedNanoUsd: bigint | null;
    usage: unknown;
    errorCode: string | null;
    createdAt: Date;
    deadlineAt: Date;
    completedAt: Date | null;
    providerId: string | null;
  }) {
    return {
      requestId: row.requestId,
      purpose: row.purpose,
      model: row.model,
      status:
        row.status === "dispatching" && row.deadlineAt.getTime() <= Date.now()
          ? "unknown"
          : row.status,
      reservedUsd: usd(row.reservedNanoUsd),
      chargedUsd: row.chargedNanoUsd == null ? null : usd(row.chargedNanoUsd),
      usage: row.usage,
      errorCode: row.errorCode,
      createdAt: row.createdAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
      durationMs:
        row.completedAt == null
          ? null
          : row.completedAt.getTime() - row.createdAt.getTime(),
      providerId: row.providerId,
    };
  }
  async status(context: AdministratorContext, requestId: string) {
    if (!validRequestId(requestId))
      throw new ModelCallError("invalid_request_id");
    const row = await this.database.prisma.modelCall.findUnique({
      where: {
        installationId_requestId: {
          installationId: context.installationId,
          requestId,
        },
      },
    });
    if (row == null || row.ownerAdministratorId !== context.administratorId)
      throw new ModelCallError("call_not_found", 404);
    return this.view(row);
  }
  async check(
    token: string | undefined,
    password: unknown,
    context: AdministratorContext,
    requestId: string,
    purpose: CredentialPurpose,
  ) {
    return this.run(
      token,
      context,
      {
        requestId,
        purpose: purpose === "answer" ? "rag_answer" : "document_embedding",
        input: CONNECTION_INPUT,
      },
      purpose,
      password,
    );
  }
  // Internal future D/E/F entrypoint. HTTP exposes only fixed synthetic checks.
  async execute(
    token: string | undefined,
    context: AdministratorContext,
    input: CallInput,
  ) {
    return this.run(token, context, input);
  }
  private async run(
    token: string | undefined,
    context: AdministratorContext,
    input: CallInput,
    check?: CredentialPurpose,
    password?: unknown,
  ): Promise<{
    call: Awaited<ReturnType<ModelExecutionService["status"]>>;
    result?: ProviderResult;
  }> {
    if (
      !validRequestId(input.requestId) ||
      typeof input.input !== "string" ||
      !input.input.trim() ||
      input.input.length > 64000
    )
      throw new ModelCallError("invalid_call_input");
    const purpose: CredentialPurpose =
      input.purpose === "document_embedding" ||
      input.purpose === "rag_question_embedding"
        ? "embedding"
        : "answer";
    const persistedPurpose = check == null ? input.purpose : `check_${check}`;
    const inputDigest = digest({
      purpose: persistedPurpose,
      input: input.input,
      fileNames: input.fileNames ?? [],
    });
    const work = async (tx: Tx, fresh: AdministratorContext) => {
      await this.lock(tx, fresh.installationId);
      const [clockRow] = await tx.$queryRaw<
        Array<{ now: Date }>
      >`SELECT clock_timestamp() AS now`;
      if (!clockRow) throw new ModelCallError("clock_unavailable", 503);
      const now = clockRow.now;
      const clock = now!;
      await tx.modelCall.updateMany({
        where: {
          installationId: fresh.installationId,
          status: "dispatching",
          deadlineAt: { lte: clock },
        },
        data: {
          status: "unknown",
          errorCode: "interrupted_or_timeout",
          completedAt: clock,
        },
      });
      const prior = await tx.modelCall.findUnique({
        where: {
          installationId_requestId: {
            installationId: fresh.installationId,
            requestId: input.requestId,
          },
        },
      });
      if (prior != null) {
        if (
          prior.ownerAdministratorId !== fresh.administratorId ||
          prior.inputDigest !== inputDigest
        )
          throw new ModelCallError("request_id_conflict", 409);
        return { prior };
      }
      const settings = await this.settings(tx, fresh.installationId);
      if (settings.priceVersion !== PRICE_VERSION)
        throw new ModelCallError("price_not_confirmed", 409);
      if (!validExecution(settings))
        throw new ModelCallError("invalid_model_settings");
      if (settings.monthlyBudgetUsd == null)
        throw new ModelCallError("budget_not_configured", 409);
      const limit = parseBudgetDecimal(settings.monthlyBudgetUsd);
      const policy = await tx.modelTransferPolicy.findUnique({
        where: { installationId: fresh.installationId },
      });
      inspectTransfer(
        policy ?? DEFAULT_TRANSFERS,
        input.purpose,
        OPENAI_ENDPOINTS[purpose],
        input.input,
        input.fileNames ?? [],
      );
      const credential = await tx.modelCredential.findUnique({
        where: {
          installationId_purpose: {
            installationId: fresh.installationId,
            purpose,
          },
        },
      });
      if (credential == null || !credential.enabled)
        throw new ModelCallError("credential_not_enabled", 409);
      const key = await this.vault.reveal(
        fresh.installationId,
        purpose,
        credential,
      );
      const bound = inputBound(input.input);
      if (
        bound > settings.inputTokenLimit ||
        (purpose === "embedding" && bound > 8192)
      )
        throw new ModelCallError("input_limit_exceeded", 413);
      const model =
        purpose === "embedding" ? FIXED_EMBEDDING.model : settings.answerModel;
      const request: ProviderRequest = {
        model,
        input: input.input,
        outputLimit: purpose === "embedding" ? 0 : settings.outputTokenLimit,
        reasoning: settings.reasoning,
      };
      if (purpose === "answer") {
        if (
          (await tx.modelCall.count({
            where: {
              installationId: fresh.installationId,
              status: "dispatching",
              model: { in: [...ANSWER_MODELS] },
            },
          })) > 0
        )
          throw new ModelCallError("answer_busy", 429);
        if (
          (await tx.modelCall.count({
            where: {
              installationId: fresh.installationId,
              model: { in: [...ANSWER_MODELS] },
              createdAt: { gte: new Date(clock.getTime() - 60000) },
            },
          })) >= 10
        )
          throw new ModelCallError("call_rate_limited", 429);
      }
      const held = reservation(
        model,
        purpose === "embedding"
          ? Math.min(8192, settings.inputTokenLimit)
          : settings.inputTokenLimit,
        request.outputLimit,
      );
      const exposure = await this.exposure(
        tx,
        fresh.installationId,
        this.month(clock),
      );
      if (exposure.charged + exposure.held + held > limit)
        throw new ModelCallError("budget_exceeded", 429);
      const row = await tx.modelCall.create({
        data: {
          installationId: fresh.installationId,
          requestId: input.requestId,
          ownerAdministratorId: fresh.administratorId,
          purpose: persistedPurpose,
          model,
          credentialTag: credential.tag,
          inputDigest,
          configurationDigest: digest(settings),
          priceVersion: PRICE_VERSION,
          reservedNanoUsd: held,
          status: "dispatching",
          createdAt: clock,
          deadlineAt: new Date(clock.getTime() + TIMEOUT_MS),
        },
      });
      return { dispatch: { row, request, key } };
    };
    const authorization =
      check == null
        ? await this.auth.authorizedOperation(token, context, work)
        : await this.auth.sensitiveOperation(token, password, context, work);
    if (!authorization.ok)
      throw new ModelCallError(
        authorization.code,
        authorization.code === "throttled"
          ? 429
          : authorization.code === "invalid_request"
            ? 400
            : 401,
      );
    if (authorization.prior != null)
      return { call: this.view(authorization.prior) };
    const dispatch = authorization.dispatch!;
    const remaining = dispatch.row.deadlineAt.getTime() - Date.now();
    if (remaining <= 0) {
      await this.database.prisma.modelCall.update({
        where: {
          installationId_requestId: {
            installationId: context.installationId,
            requestId: input.requestId,
          },
        },
        data: {
          status: "not_sent",
          chargedNanoUsd: 0n,
          errorCode: "dispatch_deadline_exceeded",
          completedAt: new Date(),
        },
      });
      return { call: await this.status(context, input.requestId) };
    }
    let result: ProviderResult;
    try {
      result = await this.provider.call(
        dispatch.key,
        dispatch.request,
        AbortSignal.timeout(remaining),
      );
    } catch (error) {
      const code =
        error instanceof ModelCallError
          ? error.code
          : error != null &&
              typeof error === "object" &&
              "name" in error &&
              ["AbortError", "TimeoutError"].includes(String(error.name))
            ? "provider_timeout"
            : "provider_transport_failed";
      await this.database.prisma.modelCall.updateMany({
        where: {
          installationId: context.installationId,
          requestId: input.requestId,
          status: { in: ["dispatching", "unknown"] },
        },
        data: { status: "unknown", errorCode: code, completedAt: new Date() },
      });
      return { call: await this.status(context, input.requestId) };
    }
    // If persistence fails after provider success, dispatching+reservation remain.
    // A repeated request returns that state and never silently calls again.
    await this.database.prisma.$transaction(async (tx) => {
      await this.lock(tx, context.installationId);
      await tx.modelCall.update({
        where: {
          installationId_requestId: {
            installationId: context.installationId,
            requestId: input.requestId,
          },
        },
        data: {
          status: result.outcome,
          chargedNanoUsd: cost(dispatch.request.model, result.usage),
          usage: result.usage,
          providerId: result.providerId,
          errorCode:
            result.outcome === "incomplete" ? "output_incomplete" : null,
          completedAt: new Date(),
        },
      });
    });
    return { call: await this.status(context, input.requestId), result };
  }
}
// Stored normalized USD permits nano precision; public writes accept cents only.
function parseBudgetDecimal(value: string): bigint {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole!) * 1000000000n + BigInt(fraction.padEnd(9, "0"));
}
