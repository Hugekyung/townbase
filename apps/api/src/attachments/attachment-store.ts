import { DeletionJournal } from "../operations/deletion-journal";
import {
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { Prisma, PrismaClient } from "@townbase/database";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import {
  AuthService,
  type AdministratorContext,
  type AuthTransaction,
} from "../auth/auth.service";
import { DeploymentDatabase } from "../deployment/deployment-database";
import { AgentService } from "../agent/agent.service";
import { FileStorage } from "../files/file-storage";
import { fileFormat } from "../files/file-contract";
import {
  DEFAULT_EXECUTION,
  MIN_ANSWER_INPUT_TOKEN_LIMIT,
  digest,
  ModelCallError,
  validRequestId,
} from "../model-integration/model-policy";
import { assertFileSourcesCurrent } from "../files/file-source";
import { savedSources } from "../rag/rag-store";
import {
  answerText,
  parseGroundedResult,
  resolvedMode,
  RAG_LIMITS,
  type RagSource,
  type GroundedResult,
} from "../rag/rag-policy";
import {
  ATTACHMENT_LIMITS,
  attachmentCallId,
  type AttachmentInput,
} from "./attachment-policy";
import type { BasicAgentConfiguration } from "@townbase/agent-core";
type C = AdministratorContext;
type Tx = AuthTransaction;
export type PrivateTask = Prisma.AttachmentTaskGetPayload<
  Record<string, never>
>;
export type AttachmentRow = Prisma.AttachmentGetPayload<Record<string, never>>;
export type PrivateAdmission = {
  turn: PrivateTask;
  files: AttachmentRow[];
  config: BasicAgentConfiguration;
  inputLimit: number;
  history: { question: string; answer: string }[];
  historySources: RagSource[];
};
@Injectable()
export class AttachmentStore {
  readonly storage = new FileStorage(
    path.join(
      process.env.TOWNBASE_ATTACHMENTS_PATH ?? "/var/lib/townbase/attachments",
      "temporary",
    ),
  );
  private busy = false;
  constructor(
    readonly db: DeploymentDatabase,
    private readonly auth: AuthService,
    private readonly agents: AgentService,
    private readonly journal: DeletionJournal,
  ) {}
  scope(c: C) {
    return {
      installationId: c.installationId,
      ownerAdministratorId: c.administratorId,
    };
  }
  async scoped<T>(
    token: string | undefined,
    c: C,
    work: (tx: Tx, fresh: C, now: Date) => Promise<T>,
  ) {
    const result = await this.auth.authorizedOperation(
      token,
      c,
      async (tx, fresh, now) => ({ value: await work(tx, fresh, now) }),
    );
    if (!result.ok) throw new UnauthorizedException({ code: "unauthorized" });
    return result.value;
  }
  async locked<T>(work: () => Promise<T>) {
    if (this.busy) throw new ModelCallError("attachment_storage_busy", 409);
    this.busy = true;
    const url = new URL(process.env.DATABASE_URL!);
    url.searchParams.set("connection_limit", "1");
    const lease = new PrismaClient({
      datasources: { db: { url: url.toString() } },
    });
    try {
      const [lock] = await lease.$queryRaw<
        { acquired: boolean }[]
      >`SELECT pg_try_advisory_lock(741126,7) AS acquired`;
      if (!lock?.acquired)
        throw new ModelCallError("attachment_storage_busy", 409);
      return await work();
    } finally {
      await lease.$disconnect();
      this.busy = false;
    }
  }
  async upload(token: string | undefined, c: C, name: string, bytes: Buffer) {
    if (bytes.length < 1 || bytes.length > ATTACHMENT_LIMITS.bytes)
      throw new ModelCallError("file_too_large", 413);
    const format = fileFormat(name);
    return this.locked(async () => {
      await this.scoped(token, c, async (tx, fresh, now) => {
        await tx.$queryRaw`SELECT id FROM "Installation" WHERE id=${fresh.installationId} FOR UPDATE`;
        if (
          (await tx.attachment.count({
            where: {
              ...this.scope(fresh),
              blockedAt: null,
              expiresAt: { gt: now },
            },
          })) >= 20
        )
          throw new ModelCallError("attachment_upload_limit", 429);
      });
      const storageKey = await this.storage.write(bytes);
      try {
        return await this.scoped(token, c, async (tx, fresh, now) => {
          const row = await tx.attachment.create({
            data: {
              ...this.scope(fresh),
              id: randomUUID(),
              fileName: name,
              format,
              byteSize: bytes.length,
              contentHash: createHash("sha256").update(bytes).digest("hex"),
              storageKey,
              createdAt: now,
              expiresAt: new Date(
                now.getTime() + ATTACHMENT_LIMITS.temporaryMs,
              ),
            },
          });
          return this.fileView(row, now);
        });
      } catch (error) {
        // An uncertain commit must be reconciled before unlinking its raw file.
        const row = await this.db.prisma.attachment.findFirst({
          where: { storageKey },
        });
        if (!row) await this.storage.removeIfPresent(storageKey);
        throw error;
      }
    });
  }
  fileView(row: AttachmentRow, now: Date) {
    return {
      id: row.id,
      fileName: row.fileName,
      format: row.format,
      byteSize: row.byteSize,
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      available:
        row.blockedAt == null &&
        row.taskRequestId == null &&
        row.expiresAt > now,
      rawDeleted: row.rawDeletedAt != null,
    };
  }
  list(token: string | undefined, c: C) {
    return this.scoped(token, c, async (tx, fresh, now) => ({
      attachments: (
        await tx.attachment.findMany({
          where: {
            ...this.scope(fresh),
            blockedAt: null,
            expiresAt: { gt: now },
          },
          orderBy: { createdAt: "desc" },
          take: 20,
        })
      ).map((r) => this.fileView(r, now)),
    }));
  }
  async remove(token: string | undefined, c: C, id: string) {
    await this.scoped(token, c, async (tx, fresh, now) => {
      const row = await tx.attachment.findFirst({
        where: { ...this.scope(fresh), id },
      });
      if (!row) throw new NotFoundException();
      if (row.taskRequestId != null)
        throw new ModelCallError("attachment_in_use", 409);
      await tx.attachment.update({
        where: { id },
        data: { blockedAt: row.blockedAt ?? now },
      });
    });
    await this.cleanup();
    return { deleted: true };
  }
  async execution(tx: Tx, c: C) {
    const row = await tx.modelExecutionSettings.findUnique({
      where: { installationId: c.installationId },
    });
    const value = {
      answerModel: row?.answerModel ?? DEFAULT_EXECUTION.answerModel,
      reasoning: row?.reasoning ?? DEFAULT_EXECUTION.reasoning,
      inputTokenLimit:
        row?.inputTokenLimit ?? DEFAULT_EXECUTION.inputTokenLimit,
      outputTokenLimit:
        row?.outputTokenLimit ?? DEFAULT_EXECUTION.outputTokenLimit,
      monthlyBudget: row?.monthlyBudgetNanoUsd?.toString() ?? null,
      priceVersion: row?.priceVersion ?? null,
    };
    return { ...value, digest: digest(value) };
  }
  async sourcesCurrent(tx: Tx, c: C, sources: RagSource[]) {
    if (sources.length) await assertFileSourcesCurrent(tx, c, sources);
  }
  async admit(
    token: string | undefined,
    c: C,
    input: AttachmentInput,
    closing: () => boolean,
  ) {
    return this.scoped(token, c, async (tx, fresh, now) => {
      if (closing()) throw new ModelCallError("attachment_unavailable", 503);
      await tx.$queryRaw`SELECT id FROM "Installation" WHERE id=${fresh.installationId} FOR UPDATE`;
      const prior = await tx.attachmentTask.findUnique({
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
          prior.fingerprint !== digest(input)
        )
          throw new ModelCallError("request_id_conflict", 409);
        if (prior.expiresAt <= now)
          throw new ModelCallError("question_expired", 410);
        return { prior };
      }
      if (
        await tx.modelCall.count({
          where: {
            installationId: fresh.installationId,
            requestId: {
              in: [
                attachmentCallId(input.requestId, "embedding"),
                attachmentCallId(input.requestId, "answer"),
              ],
            },
          },
        })
      )
        throw new ModelCallError("request_id_used", 409);
      const running =
        (await tx.ragTurn.count({
          where: {
            installationId: fresh.installationId,
            status: "running",
            deadlineAt: { gt: now },
          },
        })) +
        (await tx.attachmentTask.count({
          where: { installationId: fresh.installationId, status: "running" },
        }));
      if (running) throw new ModelCallError("answer_busy", 429);
      const since = new Date(now.getTime() - 60000);
      if (
        (await tx.ragTurn.count({
          where: {
            installationId: fresh.installationId,
            createdAt: { gte: since },
          },
        })) +
          (await tx.attachmentTask.count({
            where: {
              installationId: fresh.installationId,
              createdAt: { gte: since },
            },
          })) >=
        10
      )
        throw new ModelCallError("question_rate_limited", 429);
      const { agent } = await this.agents.readInTransaction(tx, fresh);
      if (!agent) throw new ModelCallError("agent_not_configured", 409);
      const settings = await this.execution(tx, fresh);
      if (settings.inputTokenLimit < MIN_ANSWER_INPUT_TOKEN_LIMIT)
        throw new ModelCallError("invalid_model_settings", 409);
      const files = await tx.attachment.findMany({
        where: {
          ...this.scope(fresh),
          id: { in: input.attachmentIds },
          blockedAt: null,
          taskRequestId: null,
          rawDeletedAt: null,
          expiresAt: { gt: now },
        },
      });
      if (files.length !== input.attachmentIds.length)
        throw new ModelCallError("reattach_required", 409);
      if (
        files.reduce((n, f) => n + f.byteSize, 0) > ATTACHMENT_LIMITS.totalBytes
      )
        throw new ModelCallError("attachment_total_too_large", 413);
      const history: PrivateAdmission["history"] = [],
        historyMap = new Map<string, RagSource>();
      for (const requestId of input.historyRequestIds) {
        const old = await tx.attachmentTask.findFirst({
          where: {
            ...this.scope(fresh),
            requestId,
            expiresAt: { gt: now },
            status: { in: ["answered", "refused"] },
          },
        });
        if (!old) throw new ModelCallError("history_unavailable", 409);
        const sources = savedSources(old.ragSources);
        await this.sourcesCurrent(tx, fresh, sources);
        if (sources.length)
          await this.agents.assertSourceSelection(
            tx,
            fresh,
            agent,
            sources.map((s) => s.originalId),
          );
        sources.forEach((s) => historyMap.set(s.id, s));
        history.push({ question: old.question, answer: old.answer! });
      }
      const historySources = [...historyMap.values()];
      if (historySources.length > 20)
        throw new ModelCallError("history_limit_exceeded", 413);
      const turn = await tx.attachmentTask.create({
        data: {
          ...this.scope(fresh),
          requestId: input.requestId,
          fingerprint: digest(input),
          agentId: agent.id,
          agentRevision: agent.revision,
          executionDigest: settings.digest,
          operation: input.operation,
          question: input.question,
          ragQuestion: input.ragQuestion,
          requestedMode: input.requestedMode,
          resolvedMode: resolvedMode(
            input.requestedMode,
            input.ragQuestion ?? input.question,
          ),
          attachmentIds: input.attachmentIds,
          historyRequestIds: input.historyRequestIds,
          status: "running",
          ragSources: historySources as unknown as Prisma.InputJsonValue,
          createdAt: now,
          deadlineAt: new Date(now.getTime() + RAG_LIMITS.timeoutMs),
          expiresAt: new Date(now.getTime() + ATTACHMENT_LIMITS.retentionMs),
        },
      });
      for (const file of files) {
        const r = await tx.attachment.updateMany({
          where: {
            id: file.id,
            taskRequestId: null,
            blockedAt: null,
            expiresAt: { gt: now },
          },
          data: { taskRequestId: turn.requestId },
        });
        if (r.count !== 1) throw new ModelCallError("reattach_required", 409);
      }
      return {
        admission: {
          turn,
          files,
          config: agent,
          inputLimit: settings.inputTokenLimit,
          history,
          historySources,
        },
      };
    });
  }
  async guard(
    tx: Tx,
    c: C,
    a: PrivateAdmission,
    sources: RagSource[],
    clock?: Date,
  ) {
    const now =
      clock ??
      (await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`)[0]!
        .now;
    if (
      !(await tx.attachmentTask.count({
        where: {
          ...this.scope(c),
          requestId: a.turn.requestId,
          status: "running",
          deadlineAt: { gt: now },
        },
      }))
    )
      throw new ModelCallError("question_interrupted", 409);
    const { agent } = await this.agents.readInTransaction(tx, c);
    if (
      !agent ||
      agent.id !== a.turn.agentId ||
      agent.revision !== a.turn.agentRevision
    )
      throw new ModelCallError("agent_changed", 409);
    if ((await this.execution(tx, c)).digest !== a.turn.executionDigest)
      throw new ModelCallError("model_settings_changed", 409);
    if (
      (await tx.attachment.count({
        where: {
          ...this.scope(c),
          id: { in: a.turn.attachmentIds },
          taskRequestId: a.turn.requestId,
          blockedAt: null,
          rawDeletedAt: null,
          expiresAt: { gt: now },
        },
      })) !== a.turn.attachmentIds.length
    )
      throw new ModelCallError("reattach_required", 409);
    await this.sourcesCurrent(tx, c, sources);
    if (sources.length)
      await this.agents.assertSourceSelection(
        tx,
        c,
        agent,
        sources.map((s) => s.originalId),
      );
  }
  async record(
    token: string | undefined,
    c: C,
    a: PrivateAdmission,
    sources: RagSource[],
    metadata: unknown,
  ) {
    return this.scoped(token, c, async (tx, fresh, now) => {
      await this.guard(tx, fresh, a, sources, now);
      await tx.attachmentTask.update({
        where: {
          installationId_requestId: {
            installationId: fresh.installationId,
            requestId: a.turn.requestId,
          },
        },
        data: {
          ragSources: sources as unknown as Prisma.InputJsonValue,
          attachmentSources: metadata as Prisma.InputJsonValue,
        },
      });
    });
  }
  async complete(
    token: string | undefined,
    c: C,
    a: PrivateAdmission,
    sources: RagSource[],
    result: GroundedResult,
    model: string,
  ) {
    return this.scoped(token, c, async (tx, fresh, now) => {
      await this.guard(tx, fresh, a, sources, now);
      const r = await tx.attachmentTask.updateMany({
        where: {
          ...this.scope(fresh),
          requestId: a.turn.requestId,
          status: "running",
        },
        data: {
          status: result.isAnswerable ? "answered" : "refused",
          result: result as unknown as Prisma.InputJsonValue,
          answer: answerText(result),
          model,
          completedAt: now,
        },
      });
      if (r.count !== 1) throw new ModelCallError("question_interrupted", 409);
      await tx.attachment.updateMany({
        where: {
          ...this.scope(fresh),
          taskRequestId: a.turn.requestId,
          blockedAt: null,
        },
        data: { blockedAt: now },
      });
    });
  }
  async fail(c: C, requestId: string, code: string) {
    await this.db.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Installation" WHERE id=${c.installationId} FOR UPDATE`;
      await tx.attachmentTask.updateMany({
        where: { ...this.scope(c), requestId, status: "running" },
        data: { status: "failed", errorCode: code, completedAt: new Date() },
      });
      await tx.attachment.updateMany({
        where: { ...this.scope(c), taskRequestId: requestId, blockedAt: null },
        data: { blockedAt: new Date() },
      });
    });
  }
  async view(tx: Tx, c: C, row: PrivateTask, now: Date) {
    const sources = savedSources(row.ragSources);
    let available = true;
    try {
      await this.sourcesCurrent(tx, c, sources);
    } catch (e) {
      if (e instanceof ModelCallError && e.code === "source_changed")
        available = false;
      else throw e;
    }
    const metadata = row.attachmentSources;
    if (
      !Array.isArray(metadata) ||
      metadata.length > 256 ||
      metadata.some(
        (s) =>
          s == null ||
          typeof s !== "object" ||
          Array.isArray(s) ||
          !validRequestId(s.id) ||
          !validRequestId(s.attachmentId) ||
          s.kind !== "attachment" ||
          typeof s.title !== "string" ||
          (s.promptLabel != null &&
            (typeof s.promptLabel !== "string" ||
              !/^S[1-9][0-9]{0,2}$/.test(s.promptLabel))) ||
          typeof s.fileName !== "string" ||
          !Array.isArray(s.locations),
      )
    )
      throw new ModelCallError("stored_result_unavailable", 503);
    let result: GroundedResult | null = null;
    if (available && row.result != null) {
      try {
        const raw = row.result as unknown as GroundedResult;
        if (!Array.isArray(raw.claims) || !Array.isArray(raw.conflicts))
          throw Error();
        const quotes = [...raw.claims, ...raw.conflicts].flatMap((claim) => {
          if (!Array.isArray(claim.evidence)) throw Error();
          return claim.evidence;
        });
        const privateSources = metadata.map((s) => {
          const m = s as { id: string; attachmentId: string };
          return {
            id: m.id,
            originalId: m.attachmentId,
            content: quotes
              .filter((e) => e.sourceId === m.id)
              .map((e) => e.quote)
              .join("\n"),
          } as RagSource;
        });
        result = parseGroundedResult(JSON.stringify(row.result), [
          ...privateSources,
          ...sources,
        ]);
        if (
          answerText(result) !== row.answer ||
          (row.status === "answered") !== result.isAnswerable
        )
          throw Error();
      } catch {
        throw new ModelCallError("stored_result_unavailable", 503);
      }
    }
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
        requestId: {
          in: [
            attachmentCallId(row.requestId, "answer"),
            attachmentCallId(row.requestId, "embedding"),
          ],
        },
      },
      select: {
        requestId: true,
        purpose: true,
        model: true,
        status: true,
        usage: true,
        chargedNanoUsd: true,
        reservedNanoUsd: true,
        errorCode: true,
      },
    });
    return {
      requestId: row.requestId,
      operation: row.operation,
      question: available ? row.question : null,
      ragQuestion: available ? row.ragQuestion : null,
      status:
        row.status === "running" && row.deadlineAt <= now
          ? "interrupted"
          : row.status,
      errorCode:
        row.status === "running" && row.deadlineAt <= now
          ? "question_timeout"
          : row.errorCode,
      answer: result ? answerText(result) : null,
      result,
      model: row.model,
      sourceState: available ? "available" : "unavailable",
      sources: available
        ? [
            ...metadata.filter((s) => used.has((s as { id: string }).id)),
            ...sources
              .filter((s) => used.has(s.id))
              .map((s) => ({ ...s, kind: "rag" })),
          ]
        : [],
      contextSourceCount: metadata.length + sources.length,
      attachmentIds: row.attachmentIds,
      historyRequestIds: row.historyRequestIds,
      createdAt: row.createdAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
      expiresAt: row.expiresAt.toISOString(),
      calls: calls.map((call) => ({
        ...call,
        chargedNanoUsd: call.chargedNanoUsd?.toString() ?? null,
        reservedNanoUsd: call.reservedNanoUsd.toString(),
      })),
      reattachRequired: row.status !== "running",
    };
  }
  read(token: string | undefined, c: C, id: string) {
    return this.scoped(token, c, async (tx, fresh, now) => {
      const row = await tx.attachmentTask.findFirst({
        where: { ...this.scope(fresh), requestId: id, expiresAt: { gt: now } },
      });
      if (!row) throw new NotFoundException();
      return this.view(tx, fresh, row, now);
    });
  }
  summaries(token: string | undefined, c: C, cursor?: string) {
    return this.scoped(token, c, async (tx, fresh, now) => {
      const anchor =
        cursor == null
          ? null
          : await tx.attachmentTask.findFirst({
              where: {
                ...this.scope(fresh),
                requestId: cursor,
                expiresAt: { gt: now },
              },
              select: { createdAt: true, requestId: true },
            });
      if (cursor != null && !anchor) throw new ModelCallError("invalid_cursor");
      const rows = await tx.attachmentTask.findMany({
        where: {
          ...this.scope(fresh),
          expiresAt: { gt: now },
          ...(anchor
            ? {
                OR: [
                  { createdAt: { lt: anchor.createdAt } },
                  {
                    createdAt: anchor.createdAt,
                    requestId: { lt: anchor.requestId },
                  },
                ],
              }
            : {}),
        },
        orderBy: [{ createdAt: "desc" }, { requestId: "desc" }],
        take: 21,
        select: {
          requestId: true,
          question: true,
          createdAt: true,
          status: true,
          ragSources: true,
        },
      });
      const tasks = [];
      for (const row of rows.slice(0, 20)) {
        let title = [...row.question].slice(0, 60).join("");
        try {
          await this.sourcesCurrent(tx, fresh, savedSources(row.ragSources));
        } catch (e) {
          if (e instanceof ModelCallError && e.code === "source_changed")
            title = "근거가 변경된 첨부 작업";
          else throw e;
        }
        tasks.push({
          requestId: row.requestId,
          title,
          status: row.status,
          createdAt: row.createdAt.toISOString(),
        });
      }
      return {
        tasks,
        nextCursor: rows.length > 20 ? rows[19]!.requestId : null,
      };
    });
  }
  history(token: string | undefined, c: C, cursor?: string) {
    return this.scoped(token, c, async (tx, fresh, now) => {
      const rows = await tx.attachmentTask.findMany({
        where: {
          ...this.scope(fresh),
          expiresAt: { gt: now },
          ...(cursor ? { requestId: { gt: cursor } } : {}),
        },
        orderBy: { requestId: "asc" },
        take: 21,
      });
      const tasks = [];
      for (const row of rows.slice(0, 20))
        tasks.push(await this.view(tx, fresh, row, now));
      return {
        tasks,
        nextCursor: rows.length > 20 ? rows[19]!.requestId : null,
      };
    });
  }
  async stop(token: string | undefined, c: C, id: string) {
    await this.scoped(token, c, async (tx, fresh, now) => {
      const row = await tx.attachmentTask.findFirst({
        where: { ...this.scope(fresh), requestId: id },
      });
      if (!row) throw new NotFoundException();
      await tx.attachmentTask.updateMany({
        where: { ...this.scope(fresh), requestId: id, status: "running" },
        data: {
          status: "interrupted",
          errorCode: "user_stopped",
          completedAt: now,
        },
      });
      await tx.attachment.updateMany({
        where: { ...this.scope(fresh), taskRequestId: id, blockedAt: null },
        data: { blockedAt: now },
      });
    });
  }
  async removeResult(token: string | undefined, c: C, id: string) {
    const record = await this.journal.accept(token, c, "private_result", id);
    await this.journal.apply(record);
    await this.cleanup();
    return { deleted: true };
  }
  async cleanup(restarted = false) {
    return this.locked(async () => {
      await this.db.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "AuthenticationState" WHERE id='primary' FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM "Installation" FOR UPDATE`;
        const now = (
          await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`
        )[0]!.now;
        await tx.attachmentTask.updateMany({
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
        await tx.attachment.updateMany({
          where: {
            blockedAt: null,
            OR: [
              { expiresAt: { lte: now } },
              { task: { status: { not: "running" } } },
            ],
          },
          data: { blockedAt: now },
        });
      });
      const rows = await this.db.prisma.attachment.findMany({
        where: { blockedAt: { not: null }, rawDeletedAt: null },
        take: 200,
      });
      for (const row of rows) {
        try {
          await this.storage.removeIfPresent(row.storageKey);
          await this.db.prisma.attachment.update({
            where: { id: row.id },
            data: { rawDeletedAt: new Date() },
          });
        } catch {
          Logger.error("TOWNBASE_ATTACHMENT_CLEANUP_FAILED");
        }
      }
      for await (const key of this.storage.keys()) {
        if (
          !(await this.db.prisma.attachment.count({
            where: { storageKey: key },
          }))
        )
          await this.storage.removeIfPresent(key);
      }
      await this.db.prisma.attachment.deleteMany({
        where: { rawDeletedAt: { not: null }, expiresAt: { lte: new Date() } },
      });
      const expired = await this.db.prisma.attachmentTask.findMany({
        where: { expiresAt: { lte: new Date() }, attachments: { none: {} } },
        take: 200,
        select: { installationId: true, requestId: true },
      });
      if (expired.length)
        await this.db.prisma.attachmentTask.deleteMany({
          where: { OR: expired },
        });
    });
  }
}
