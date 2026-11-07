import { Injectable, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { Prisma } from "@townbase/database";
import type { BasicAgentConfiguration } from "@townbase/agent-core";
import {
  AuthService,
  type AdministratorContext,
  type AuthTransaction,
} from "../auth/auth.service";
import { AgentService } from "../agent/agent.service";
import { DeploymentDatabase } from "../deployment/deployment-database";
import {
  assertFileSourcesCurrent,
  type FileSource,
} from "../files/file-source";
import {
  DEFAULT_EXECUTION,
  MIN_ANSWER_INPUT_TOKEN_LIMIT,
  digest,
  ModelCallError,
  validRequestId,
  usd,
} from "../model-integration/model-policy";
import {
  callId,
  RAG_LIMITS,
  resolvedMode,
  answerText,
  parseGroundedResult,
  type RagQuestion,
  type RagSource,
  type GroundedResult,
} from "./rag-policy";
import { randomUUID } from "node:crypto";

export type Turn = Prisma.RagTurnGetPayload<Record<string, never>>;
type Context = AdministratorContext;
type Tx = AuthTransaction;
export type Admission = {
  turn: Turn;
  config: BasicAgentConfiguration;
  inputLimit: number;
  history: { question: string; answer: string }[];
  historySources: RagSource[];
};
export function savedSources(value: Prisma.JsonValue): RagSource[] {
  if (
    !Array.isArray(value) ||
    value.length > 20 ||
    value.some(
      (s) =>
        s == null ||
        typeof s !== "object" ||
        Array.isArray(s) ||
        typeof s.content !== "string" ||
        s.content.length > 16000 ||
        typeof s.title !== "string" ||
        !Array.isArray(s.locations) ||
        typeof s.reference !== "string",
    )
  )
    throw new ModelCallError("stored_result_unavailable", 503);
  const sources = value as unknown as RagSource[];
  if (
    sources.some(
      (s) =>
        ![s.id, s.indexId, s.originalId, s.versionId].every(validRequestId) ||
        !Number.isInteger(s.scopeRevision) ||
        s.scopeRevision < 1 ||
        createHash("sha256").update(s.content).digest("hex") !== s.chunkHash,
    )
  )
    throw new ModelCallError("stored_result_unavailable", 503);
  return sources;
}
function unionSources(...groups: readonly RagSource[][]) {
  const unique = new Map(groups.flat().map((s) => [s.id, s]));
  if (unique.size > 20) throw new ModelCallError("history_limit_exceeded", 413);
  return [...unique.values()];
}
@Injectable()
export class RagStore {
  constructor(
    readonly db: DeploymentDatabase,
    private readonly auth: AuthService,
    private readonly agents: AgentService,
  ) {}
  scope(c: Context) {
    return {
      installationId: c.installationId,
      ownerAdministratorId: c.administratorId,
    };
  }
  async scoped<T>(
    token: string | undefined,
    c: Context,
    work: (tx: Tx, fresh: Context, now: Date) => Promise<T>,
  ) {
    const result = await this.auth.authorizedOperation(
      token,
      c,
      async (tx, fresh, now) => ({ value: await work(tx, fresh, now) }),
    );
    if (!result.ok) throw new ModelCallError("unauthorized", 401);
    return result.value;
  }
  private async execution(tx: Tx, c: Context) {
    const row = await tx.modelExecutionSettings.findUnique({
      where: { installationId: c.installationId },
    });
    const state = {
      answerModel: row?.answerModel ?? DEFAULT_EXECUTION.answerModel,
      reasoning: row?.reasoning ?? DEFAULT_EXECUTION.reasoning,
      inputTokenLimit:
        row?.inputTokenLimit ?? DEFAULT_EXECUTION.inputTokenLimit,
      outputTokenLimit:
        row?.outputTokenLimit ?? DEFAULT_EXECUTION.outputTokenLimit,
      monthlyBudget: row?.monthlyBudgetNanoUsd?.toString() ?? null,
      priceVersion: row?.priceVersion ?? null,
    };
    return { ...state, digest: digest(state) };
  }
  async sourcesCurrent(tx: Tx, c: Context, sources: readonly FileSource[]) {
    if (!Array.isArray(sources) || sources.length > 20)
      throw new ModelCallError("stored_result_unavailable", 503);
    if (sources.length) await assertFileSourcesCurrent(tx, c, sources);
  }
  async guard(
    tx: Tx,
    c: Context,
    turn: Turn,
    sources: RagSource[],
    clock?: Date,
  ) {
    const now =
      clock ??
      (await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`)[0]!
        .now;
    const running = await tx.ragTurn.findFirst({
      where: {
        ...this.scope(c),
        requestId: turn.requestId,
        status: "running",
        deadlineAt: { gt: now },
      },
    });
    if (!running) throw new ModelCallError("question_interrupted", 409);
    const { agent } = await this.agents.readInTransaction(tx, c);
    if (
      !agent ||
      agent.id !== turn.agentId ||
      agent.revision !== turn.agentRevision
    )
      throw new ModelCallError("agent_changed", 409);
    if ((await this.execution(tx, c)).digest !== turn.executionDigest)
      throw new ModelCallError("model_settings_changed", 409);
    if (sources.length)
      await this.agents.assertSourceSelection(
        tx,
        c,
        agent,
        sources.map((s) => s.originalId),
      );
    await this.sourcesCurrent(tx, c, sources);
  }
  admit(
    token: string | undefined,
    c: Context,
    input: RagQuestion,
    isClosing: () => boolean,
  ) {
    return this.scoped(token, c, async (tx, fresh, now) => {
      if (isClosing()) throw new ModelCallError("question_unavailable", 503);
      await tx.$queryRaw`SELECT id FROM "Installation" WHERE id=${fresh.installationId} FOR UPDATE`;
      const fingerprint = digest(input);
      const prior = await tx.ragTurn.findUnique({
        where: {
          installationId_requestId: {
            installationId: fresh.installationId,
            requestId: input.requestId,
          },
        },
      });
      if (prior) {
        if (
          prior.ownerAdministratorId !== fresh.administratorId ||
          prior.fingerprint !== fingerprint
        )
          throw new ModelCallError("request_id_conflict", 409);
        if (prior.expiresAt <= now)
          throw new ModelCallError("question_expired", 410);
        return { prior };
      }
      // ModelCall retains deterministic IDs longer than conversations. A used UUID
      // must never trigger a fresh call after a turn expires or was restored away.
      if (
        await tx.modelCall.count({
          where: {
            installationId: fresh.installationId,
            requestId: {
              in: [
                callId(input.requestId, "embedding"),
                callId(input.requestId, "answer"),
              ],
            },
          },
        })
      )
        throw new ModelCallError("request_id_used", 409);
      await tx.ragTurn.updateMany({
        where: {
          installationId: fresh.installationId,
          status: "running",
          deadlineAt: { lte: now },
        },
        data: {
          status: "interrupted",
          errorCode: "question_timeout",
          completedAt: now,
        },
      });
      if (
        await tx.ragTurn.count({
          where: { installationId: fresh.installationId, status: "running" },
        })
      )
        throw new ModelCallError("answer_busy", 429);
      if (
        (await tx.ragTurn.count({
          where: {
            installationId: fresh.installationId,
            createdAt: { gte: new Date(now.getTime() - 60_000) },
          },
        })) >= RAG_LIMITS.perMinute
      )
        throw new ModelCallError("question_rate_limited", 429);
      const { agent } = await this.agents.readInTransaction(tx, fresh);
      if (!agent) throw new ModelCallError("agent_not_configured", 409);
      const settings = await this.execution(tx, fresh);
      // Existing installations may retain a smaller historical C setting.
      // Require an explicit settings change before persisting or charging a turn.
      if (settings.inputTokenLimit < MIN_ANSWER_INPUT_TOKEN_LIMIT)
        throw new ModelCallError("invalid_model_settings", 409);
      let conversationId = input.conversationId;
      if (conversationId) {
        const conversation = await tx.ragConversation.findFirst({
          where: {
            ...this.scope(fresh),
            id: conversationId,
            turns: { some: { expiresAt: { gt: now } } },
          },
        });
        if (!conversation)
          throw new NotFoundException({ code: "conversation_not_found" });
      } else {
        conversationId = randomUUID();
        await tx.ragConversation.create({
          data: { ...this.scope(fresh), id: conversationId },
        });
      }
      const history: Admission["history"] = [];
      const historyGroups: RagSource[][] = [];
      for (const requestId of input.historyRequestIds) {
        const row = await tx.ragTurn.findFirst({
          where: {
            ...this.scope(fresh),
            conversationId,
            requestId,
            expiresAt: { gt: now },
            status: { in: ["answered", "refused"] },
          },
        });
        if (!row) throw new ModelCallError("history_unavailable", 409);
        const sources = savedSources(row.sources);
        await this.sourcesCurrent(tx, fresh, sources);
        if (sources.length)
          await this.agents.assertSourceSelection(
            tx,
            fresh,
            agent,
            sources.map((s) => s.originalId),
          );
        historyGroups.push(sources);
        history.push({ question: row.question, answer: row.answer! });
      }
      const historySources = unionSources(...historyGroups);
      const turn = await tx.ragTurn.create({
        data: {
          ...this.scope(fresh),
          requestId: input.requestId,
          conversationId,
          agentId: agent.id,
          agentRevision: agent.revision,
          executionDigest: settings.digest,
          fingerprint,
          question: input.question,
          requestedMode: input.requestedMode,
          resolvedMode: resolvedMode(input.requestedMode, input.question),
          historyRequestIds: input.historyRequestIds,
          configuredModel: settings.answerModel,
          status: "running",
          sources: historySources as unknown as Prisma.InputJsonValue,
          embeddingRequestId: callId(input.requestId, "embedding"),
          answerRequestId: callId(input.requestId, "answer"),
          createdAt: now,
          deadlineAt: new Date(now.getTime() + RAG_LIMITS.timeoutMs),
          expiresAt: new Date(now.getTime() + RAG_LIMITS.retentionMs),
        },
      });
      return {
        admission: {
          turn,
          config: agent,
          inputLimit: settings.inputTokenLimit,
          history,
          historySources,
        },
      };
    });
  }
  async recordSources(
    token: string | undefined,
    c: Context,
    a: Admission,
    selected: RagSource[],
  ) {
    const sources = unionSources(a.historySources, selected);
    await this.scoped(token, c, async (tx, fresh, now) => {
      await this.guard(tx, fresh, a.turn, sources, now);
      await tx.ragTurn.update({
        where: {
          installationId_requestId: {
            installationId: fresh.installationId,
            requestId: a.turn.requestId,
          },
        },
        data: { sources: sources as unknown as Prisma.InputJsonValue },
      });
    });
    return sources;
  }
  complete(
    token: string | undefined,
    c: Context,
    a: Admission,
    sources: RagSource[],
    result: GroundedResult,
    model: string | null,
  ) {
    return this.scoped(token, c, async (tx, fresh, now) => {
      await this.guard(tx, fresh, a.turn, sources, now);
      const count = await tx.ragTurn.updateMany({
        where: {
          ...this.scope(fresh),
          requestId: a.turn.requestId,
          status: "running",
        },
        data: {
          status: result.isAnswerable ? "answered" : "refused",
          model,
          result: result as unknown as Prisma.InputJsonValue,
          answer: answerText(result),
          completedAt: now,
        },
      });
      if (count.count !== 1)
        throw new ModelCallError("question_interrupted", 409);
      if (!result.isAnswerable)
        await tx.ragGap.create({
          data: {
            ...this.scope(fresh),
            id: randomUUID(),
            turnRequestId: a.turn.requestId,
            question: a.turn.question,
            requestedMode: a.turn.requestedMode,
            resolvedMode: a.turn.resolvedMode,
            reason: result.reason,
            sourceRefs: sources.map(
              ({ id, indexId, originalId, versionId, scopeRevision }) => ({
                id,
                indexId,
                originalId,
                versionId,
                scopeRevision,
              }),
            ),
          },
        });
    });
  }
  async fail(c: Context, turn: Turn, code: string) {
    await this.db.prisma.ragTurn.updateMany({
      where: { ...this.scope(c), requestId: turn.requestId, status: "running" },
      data: { status: "failed", errorCode: code, completedAt: new Date() },
    });
  }
  private async available(tx: Tx, c: Context, sources: readonly FileSource[]) {
    try {
      await this.sourcesCurrent(tx, c, sources);
      return true;
    } catch (error) {
      if (error instanceof ModelCallError && error.code === "source_changed")
        return false;
      throw error;
    }
  }
  private async turnView(tx: Tx, c: Context, row: Turn, now: Date) {
    const sources = savedSources(row.sources);
    const available = await this.available(tx, c, sources);
    let result: GroundedResult | null = null;
    if (available && row.result != null)
      result = parseGroundedResult(JSON.stringify(row.result), sources);
    const used = new Set(
      result
        ? [...result.claims, ...result.conflicts].flatMap((claim) =>
            claim.evidence.map((e) => e.sourceId),
          )
        : [],
    );
    const calls = await tx.modelCall.findMany({
      where: {
        ...this.scope(c),
        requestId: { in: [row.embeddingRequestId, row.answerRequestId] },
      },
      orderBy: { createdAt: "asc" },
    });
    const gap = await tx.ragGap.findUnique({
      where: {
        installationId_turnRequestId: {
          installationId: c.installationId,
          turnRequestId: row.requestId,
        },
      },
      select: { id: true },
    });
    return {
      requestId: row.requestId,
      conversationId: row.conversationId,
      agentId: row.agentId,
      agentRevision: row.agentRevision,
      requestedMode: row.requestedMode,
      resolvedMode: row.resolvedMode,
      configuredModel: row.configuredModel,
      model: row.model,
      status:
        row.status === "running" && row.deadlineAt <= now
          ? "interrupted"
          : row.status,
      errorCode:
        row.status === "running" && row.deadlineAt <= now
          ? "question_timeout"
          : row.errorCode,
      sourceState: available ? "available" : "unavailable",
      question: available ? row.question : null,
      answer: result ? answerText(result) : null,
      isAnswerable: result?.isAnswerable ?? null,
      result,
      gapId: available ? (gap?.id ?? null) : null,
      sources: available
        ? sources
            .filter((s) => used.has(s.id))
            .map((s) => ({ ...s, chunkId: s.id }))
        : [],
      historyRequestIds: row.historyRequestIds,
      contextSourceCount: sources.length,
      createdAt: row.createdAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
      expiresAt: row.expiresAt.toISOString(),
      durationMs:
        row.completedAt == null
          ? null
          : row.completedAt.getTime() - row.createdAt.getTime(),
      calls: calls.map((call) => ({
        requestId: call.requestId,
        purpose: call.purpose,
        model: call.model,
        status:
          call.status === "dispatching" && call.deadlineAt <= now
            ? "unknown"
            : call.status,
        errorCode: call.errorCode,
        usage: call.usage,
        createdAt: call.createdAt.toISOString(),
        completedAt: call.completedAt?.toISOString() ?? null,
        reservedUsd: usd(call.reservedNanoUsd),
        chargedUsd:
          call.chargedNanoUsd == null ? null : usd(call.chargedNanoUsd),
      })),
    };
  }
  read(token: string | undefined, c: Context, requestId: string) {
    if (!validRequestId(requestId))
      throw new ModelCallError("invalid_request_id");
    return this.scoped(token, c, async (tx, fresh, now) => {
      const row = await tx.ragTurn.findFirst({
        where: {
          ...this.scope(fresh),
          requestId: requestId.toLowerCase(),
          expiresAt: { gt: now },
        },
      });
      if (!row) throw new NotFoundException({ code: "question_not_found" });
      return this.turnView(tx, fresh, row, now);
    });
  }
  conversations(token: string | undefined, c: Context, cursor?: string) {
    if (cursor != null && !validRequestId(cursor))
      throw new ModelCallError("invalid_cursor");
    return this.scoped(token, c, async (tx, fresh, now) => {
      const rows = await tx.ragConversation.findMany({
        where: {
          ...this.scope(fresh),
          ...(cursor ? { id: { gt: cursor.toLowerCase() } } : {}),
          turns: { some: { expiresAt: { gt: now } } },
        },
        orderBy: { id: "asc" },
        take: 21,
      });
      return {
        conversations: rows.slice(0, 20).map(({ id, createdAt }) => ({
          id,
          createdAt: createdAt.toISOString(),
        })),
        nextCursor: rows.length > 20 ? rows[19]!.id : null,
      };
    });
  }
  turns(
    token: string | undefined,
    c: Context,
    conversationId: string,
    cursor?: string,
  ) {
    if (
      !validRequestId(conversationId) ||
      (cursor != null && !validRequestId(cursor))
    )
      throw new ModelCallError("invalid_request_id");
    return this.scoped(token, c, async (tx, fresh, now) => {
      if (
        !(await tx.ragConversation.findFirst({
          where: { ...this.scope(fresh), id: conversationId.toLowerCase() },
        }))
      )
        throw new NotFoundException();
      const anchor =
        cursor == null
          ? null
          : await tx.ragTurn.findFirst({
              where: {
                ...this.scope(fresh),
                conversationId: conversationId.toLowerCase(),
                requestId: cursor.toLowerCase(),
                expiresAt: { gt: now },
              },
            });
      if (cursor != null && !anchor) throw new ModelCallError("invalid_cursor");
      const rows = await tx.ragTurn.findMany({
        where: {
          ...this.scope(fresh),
          conversationId: conversationId.toLowerCase(),
          expiresAt: { gt: now },
          ...(anchor
            ? {
                OR: [
                  { createdAt: { gt: anchor.createdAt } },
                  {
                    createdAt: anchor.createdAt,
                    requestId: { gt: anchor.requestId },
                  },
                ],
              }
            : {}),
        },
        orderBy: [{ createdAt: "asc" }, { requestId: "asc" }],
        take: 21,
      });
      const turns = [];
      for (const row of rows.slice(0, 20))
        turns.push(await this.turnView(tx, fresh, row, now));
      return {
        turns,
        nextCursor: rows.length > 20 ? rows[19]!.requestId : null,
      };
    });
  }
  gaps(token: string | undefined, c: Context, cursor?: string) {
    if (cursor != null && !validRequestId(cursor))
      throw new ModelCallError("invalid_cursor");
    return this.scoped(token, c, async (tx, fresh) => {
      const rows = await tx.ragGap.findMany({
        where: {
          ...this.scope(fresh),
          ...(cursor ? { id: { gt: cursor.toLowerCase() } } : {}),
        },
        orderBy: { id: "asc" },
        take: 21,
      });
      const gaps = [];
      for (const row of rows.slice(0, 20)) {
        // Source references contain only the D05 identity tuple, not excerpts.
        const available = await this.available(
          tx,
          fresh,
          row.sourceRefs as unknown as FileSource[],
        );
        gaps.push({
          id: row.id,
          turnRequestId: row.turnRequestId,
          question: available ? row.question : null,
          reason: available ? row.reason : null,
          requestedMode: row.requestedMode,
          resolvedMode: row.resolvedMode,
          sourceState: available ? "available" : "unavailable",
          createdAt: row.createdAt.toISOString(),
        });
      }
      return { gaps, nextCursor: rows.length > 20 ? rows[19]!.id : null };
    });
  }
  removeGap(token: string | undefined, c: Context, id: string) {
    if (!validRequestId(id)) throw new ModelCallError("invalid_request_id");
    return this.scoped(token, c, async (tx, fresh) => {
      const removed = await tx.ragGap.deleteMany({
        where: { ...this.scope(fresh), id: id.toLowerCase() },
      });
      if (!removed.count) throw new NotFoundException();
      return { deleted: true };
    });
  }
  async maintenance(restarted = false) {
    await this.db.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "AuthenticationState" WHERE id='primary' FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "Installation" FOR UPDATE`;
      const [clock] = await tx.$queryRaw<
        { now: Date }[]
      >`SELECT clock_timestamp() AS now`;
      const now = clock!.now;
      await tx.ragTurn.updateMany({
        where: {
          status: "running",
          ...(restarted ? {} : { deadlineAt: { lte: now } }),
        },
        data: {
          status: "interrupted",
          errorCode: restarted ? "api_restarted" : "question_timeout",
          completedAt: now,
        },
      });
      const expired = await tx.ragTurn.findMany({
        where: { expiresAt: { lte: now } },
        orderBy: { expiresAt: "asc" },
        take: 200,
        select: { installationId: true, requestId: true },
      });
      if (expired.length)
        await tx.ragTurn.deleteMany({ where: { OR: expired } });
      const empty = await tx.ragConversation.findMany({
        where: { turns: { none: {} } },
        orderBy: { id: "asc" },
        take: 200,
        select: { id: true },
      });
      if (empty.length)
        await tx.ragConversation.deleteMany({
          where: { id: { in: empty.map((c) => c.id) }, turns: { none: {} } },
        });
    });
  }
}
