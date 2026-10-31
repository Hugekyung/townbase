import { isDeepStrictEqual } from "node:util";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import {
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  UnauthorizedException,
} from "@nestjs/common";
import { PrismaClient, type Prisma } from "@townbase/database";
import { AuthService, type AdministratorContext } from "../auth/auth.service";
import { DeploymentDatabase } from "../deployment/deployment-database";
import {
  TransferDenied,
  inspectTransfer,
  OPENAI_ENDPOINTS,
} from "../model-integration/transfer-policy";
import { FileManagementService, originalId } from "./file-management.service";
import { FileStorage } from "./file-storage";
import { FileExtractor } from "./file-extractor";
import { FileIndexService } from "./file-index.service";
import { FILE_INDEX_CONFIGURATION } from "./file-chunker";
import { ModelCallError } from "../model-integration/model-policy";
import { CredentialStorageError } from "../model-integration/credential-vault";
import {
  FILE_LIMITS,
  FileError,
  assertExtraction,
  fileFormat,
} from "./file-contract";

type Run = Prisma.FileRunGetPayload<Record<string, never>>;
type Tx = Prisma.TransactionClient;
type Identity = { token: string | undefined; context: AdministratorContext };
type Input = {
  operation: "register" | "replace" | "reprocess" | "index";
  trigger: string;
  name: string;
  hash: string;
  size: number;
  target?: string;
  base?: string;
  retryOf?: string;
  family?: string;
};
const ACTIVE = ["queued", "running"];
const CONFIGURATION = "file-extraction-d03-v1";
const RETENTION_MS = 90 * 86400_000;
const fingerprint = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function fileRequestId(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    throw new HttpException({ code: "request_id_required" }, 400);
  return value.toLowerCase();
}
async function clock(tx: Tx): Promise<Date> {
  const [row] = await tx.$queryRaw<
    Array<{ now: Date }>
  >`SELECT clock_timestamp() AS now`;
  if (!row) throw new Error("File run clock unavailable");
  return row.now;
}

@Injectable()
export class FileRunService implements OnModuleInit, OnModuleDestroy {
  private owner: PrismaClient | undefined;
  private identities = new Map<string, Identity>();
  private task: Promise<void> | undefined;
  private interval?: ReturnType<typeof setInterval>;
  private active: string | undefined;
  private activeCancellation: AbortController | undefined;
  private closing = false;
  private nextCleanupAt = 0;
  private readonly pending: FileStorage;
  constructor(
    private readonly db: DeploymentDatabase,
    private readonly auth: AuthService,
    private readonly files: FileManagementService,
    private readonly extractor: FileExtractor,
    private readonly indexing: FileIndexService,
  ) {
    this.pending = new FileStorage(
      path.join(
        process.env.TOWNBASE_DOCUMENTS_PATH ?? "/var/lib/townbase/documents",
        "pending",
      ),
    );
  }
  private async lock(key: number, wait = false) {
    const url = new URL(process.env.DATABASE_URL!);
    url.searchParams.set("connection_limit", "1");
    // Shutdown must wait for admitted input I/O, not the readiness socket timeout.
    if (wait) url.searchParams.delete("socket_timeout");
    const client = new PrismaClient({
      datasources: { db: { url: url.toString() } },
    });
    try {
      if (wait) {
        await client.$queryRaw`SELECT pg_advisory_lock(741126, ${key}::int)::text`;
        return client;
      }
      const [row] = await client.$queryRaw<
        Array<{ acquired: boolean }>
      >`SELECT pg_try_advisory_lock(741126, ${key}::int) AS acquired`;
      if (!row?.acquired)
        throw new ConflictException({ code: "file_operation_busy" });
      return client;
    } catch (error) {
      await client.$disconnect();
      throw error;
    }
  }
  private async checkOwner() {
    if (!this.owner || this.closing)
      throw new HttpException({ code: "api_stopping" }, 503);
    const [row] = await this.owner.$queryRaw<
      Array<{ owned: boolean }>
    >`SELECT EXISTS (SELECT 1 FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory' AND classid=741126::oid AND objid=4::oid AND objsubid=2 AND granted) AS owned`;
    if (!row?.owned) {
      this.closing = true;
      this.activeCancellation?.abort();
      this.extractor.cancel();
      Logger.error("TOWNBASE_FILE_RUN_OWNER_LOST");
      throw new HttpException({ code: "file_run_unavailable" }, 503);
    }
  }
  private async staging<T>(work: () => Promise<T>, wait = false): Promise<T> {
    const client = await this.lock(5, wait);
    try {
      return await work();
    } finally {
      await client.$disconnect();
    }
  }
  async onModuleInit() {
    this.closing = false;
    this.owner = await this.lock(4); // One API execution owner, no expiring lease/worker server.
    try {
      await this.files.startMaintenance();
      await this.db.prisma
        .$executeRaw`UPDATE "FileRun" SET status='interrupted', "errorCode"='api_restarted', "completedAt"=clock_timestamp() WHERE status IN ('queued','running')`;
      await this.staging(() => this.cleanup());
      this.nextCleanupAt = Date.now() + 60_000;
      this.interval = setInterval(() => this.wake(), 1000);
      this.interval.unref();
    } catch (error) {
      this.files.onApplicationShutdown();
      await this.owner.$disconnect();
      this.owner = undefined;
      throw error;
    }
  }
  async onModuleDestroy() {
    this.closing = true;
    clearInterval(this.interval);
    if (!this.owner) return;
    this.files.onApplicationShutdown();
    try {
      if (this.active) {
        try {
          await this.db.prisma.fileRun.updateMany({
            where: { id: this.active, status: "running" },
            data: {
              status: "interrupted",
              errorCode: "api_stopped",
              completedAt: new Date(),
            },
          });
        } catch {
          Logger.error("TOWNBASE_FILE_RUN_SHUTDOWN_UNCONFIRMED");
        } finally {
          this.activeCancellation?.abort();
          this.extractor.cancel();
        }
      }
      await this.task;
      // Drain any admission already holding the input lock before releasing ownership.
      // New admissions recheck closing under this same lock.
      await this.staging(async () => {
        await this.db.prisma.fileRun.updateMany({
          where: { status: "queued" },
          data: {
            status: "interrupted",
            errorCode: "api_stopped",
            completedAt: new Date(),
          },
        });
      }, true).catch(() =>
        Logger.error("TOWNBASE_FILE_RUN_SHUTDOWN_UNCONFIRMED"),
      );
    } finally {
      this.identities.clear();
      await this.owner.$disconnect();
      this.owner = undefined;
    }
  }
  private async scoped<T>(
    identity: Identity,
    work: (tx: Tx, context: AdministratorContext) => Promise<T>,
  ): Promise<T> {
    const result = await this.auth.authorizedOperation(
      identity.token,
      identity.context,
      async (tx, context) => ({ value: await work(tx, context) }),
    );
    if (!result.ok) throw new UnauthorizedException();
    return result.value;
  }
  private where(c: AdministratorContext) {
    return {
      installationId: c.installationId,
      ownerAdministratorId: c.administratorId,
    };
  }
  private retained() {
    return {
      OR: [
        { completedAt: null },
        { completedAt: { gt: new Date(Date.now() - RETENTION_MS) } },
      ],
    };
  }
  private async owned(tx: Tx, c: AdministratorContext, id: string) {
    const row = await tx.fileRun.findFirst({
      where: { ...this.where(c), ...this.retained(), id: originalId(id) },
    });
    if (!row) throw new NotFoundException();
    return row;
  }
  private async target(tx: Tx, c: AdministratorContext, id: string) {
    const row = await tx.fileOriginal.findFirst({
      where: { ...this.where(c), id: originalId(id), deletedAt: null },
      include: { versions: { orderBy: { version: "desc" }, take: 1 } },
    });
    if (!row?.versions[0]) throw new NotFoundException();
    return { original: row, version: row.versions[0] };
  }
  private async view(tx: Tx, c: AdministratorContext, run: Run) {
    const id = run.resultOriginalId ?? run.targetOriginalId;
    const source = id
      ? await tx.fileOriginal.findFirst({
          where: { ...this.where(c), id, deletedAt: null },
          select: { id: true },
        })
      : null;
    const { inputKey: _input, targetKey: _target, ...safe } = run;
    void _input;
    void _target;
    return {
      ...safe,
      sourceDeleted: id != null && source == null,
      resource: source ? `/files/${source.id}` : null,
      searchable: false,
    };
  }
  read(token: string | undefined, context: AdministratorContext, id: string) {
    return this.scoped({ token, context }, async (tx, c) =>
      this.view(tx, c, await this.owned(tx, c, id)),
    );
  }
  byRequest(
    token: string | undefined,
    context: AdministratorContext,
    id: string,
  ) {
    const requestId = fileRequestId(id);
    return this.scoped({ token, context }, async (tx, c) => {
      const request = await tx.fileRunRequest.findUnique({
        where: {
          installationId_requestId: {
            installationId: c.installationId,
            requestId,
          },
        },
      });
      if (!request) throw new NotFoundException();
      return this.view(tx, c, await this.owned(tx, c, request.runId));
    });
  }
  list(
    token: string | undefined,
    context: AdministratorContext,
    cursor?: string,
  ) {
    return this.scoped({ token, context }, async (tx, c) => {
      const anchor = cursor
        ? await this.owned(tx, c, originalId(cursor))
        : null;
      const rows = await tx.fileRun.findMany({
        where: {
          ...this.where(c),
          AND: [
            this.retained(),
            ...(anchor
              ? [
                  {
                    OR: [
                      { createdAt: { lt: anchor.createdAt } },
                      { createdAt: anchor.createdAt, id: { lt: anchor.id } },
                    ],
                  },
                ]
              : []),
          ],
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 21,
      });
      return {
        items: await Promise.all(
          rows.slice(0, 20).map((row) => this.view(tx, c, row)),
        ),
        nextCursor: rows.length > 20 ? rows[19]!.id : null,
      };
    });
  }
  private async request(
    tx: Tx,
    c: AdministratorContext,
    requestId: string,
    hash: string,
  ) {
    const entry = await tx.fileRunRequest.findUnique({
      where: {
        installationId_requestId: {
          installationId: c.installationId,
          requestId,
        },
      },
    });
    if (!entry) return null;
    const run = await this.owned(tx, c, entry.runId);
    if (entry.fingerprint !== hash)
      throw new ConflictException({ code: "request_payload_changed" });
    return run;
  }
  private async reserve(
    identity: Identity,
    requestId: string,
    hash: string,
    input: Input,
    key: string | null,
  ) {
    return this.scoped(identity, async (tx, c) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(741126, 6)::text`;
      const old = await this.request(tx, c, requestId, hash);
      if (old) return { run: old, created: false };
      if (input.retryOf) {
        await this.owned(tx, c, input.retryOf);
        const recovered = await tx.fileRun.findFirst({
          where: {
            ...this.where(c),
            status: "succeeded",
            AND: [
              this.retained(),
              {
                OR: [
                  { retryOfId: input.retryOf },
                  ...(input.family ? [{ targetKey: input.family }] : []),
                ],
              },
            ],
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        });
        if (recovered) {
          await tx.fileRunRequest.create({
            data: {
              installationId: c.installationId,
              requestId,
              runId: recovered.id,
              fingerprint: hash,
            },
          });
          return { run: recovered, created: false };
        }
      }
      if (input.target) {
        const current = await this.target(tx, c, input.target);
        if (current.version.id !== input.base)
          throw new ConflictException({ code: "source_changed" });
      }
      const targetKey = input.target
        ? `original:${input.target}`
        : (input.family ?? `upload:${requestId}`);
      const active = await tx.fileRun.findFirst({
        where: {
          installationId: c.installationId,
          targetKey,
          status: { in: ACTIVE },
        },
      });
      let run: Run;
      if (active) {
        if (
          active.operation !== input.operation ||
          active.baseVersionId !== (input.base ?? null) ||
          active.contentHash !== input.hash ||
          active.fileName !== input.name ||
          active.retryOfId !== (input.retryOf ?? null)
        )
          throw new ConflictException({ code: "target_busy" });
        run = active;
      } else {
        if (
          (await tx.fileRun.count({
            where: { installationId: c.installationId, status: { in: ACTIVE } },
          })) >= 20
        )
          throw new HttpException({ code: "file_queue_full" }, 429);
        run = await tx.fileRun.create({
          data: {
            id: randomUUID(),
            ...this.where(c),
            operation: input.operation,
            trigger: input.trigger,
            targetKey,
            targetOriginalId: input.target ?? null,
            baseVersionId: input.base ?? null,
            retryOfId: input.retryOf ?? null,
            fileName: input.name,
            format: fileFormat(input.name),
            byteSize: input.size,
            contentHash: input.hash,
            inputKey: key,
            configurationVersion:
              input.operation === "index"
                ? FILE_INDEX_CONFIGURATION
                : CONFIGURATION,
            status: "queued",
          },
        });
      }
      await tx.fileRunRequest.create({
        data: {
          installationId: c.installationId,
          requestId,
          runId: run.id,
          fingerprint: hash,
        },
      });
      return { run, created: !active };
    });
  }
  private async acknowledged(
    identity: Identity,
    requestId: string,
    hash: string,
    input: Input,
    bytes?: Buffer | (() => Promise<Buffer>),
  ) {
    if (this.closing) throw new HttpException({ code: "api_stopping" }, 503);
    await this.checkOwner();
    return this.staging(async () => {
      await this.checkOwner();
      const old = await this.scoped(identity, (tx, c) =>
        this.request(tx, c, requestId, hash),
      );
      if (old) return { runId: old.id, status: old.status, existing: true };
      const parentId = input.retryOf;
      if (parentId) {
        const recovered = await this.scoped(identity, async (tx, c) => {
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(741126, 6)::text`;
          const replay = await this.request(tx, c, requestId, hash);
          if (replay) return replay;
          await this.owned(tx, c, parentId);
          const run = await tx.fileRun.findFirst({
            where: {
              ...this.where(c),
              status: "succeeded",
              AND: [
                this.retained(),
                {
                  OR: [
                    { retryOfId: parentId },
                    ...(input.family ? [{ targetKey: input.family }] : []),
                  ],
                },
              ],
            },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          });
          if (run)
            await tx.fileRunRequest.create({
              data: {
                installationId: c.installationId,
                requestId,
                runId: run.id,
                fingerprint: hash,
              },
            });
          return run;
        });
        if (recovered)
          return {
            runId: recovered.id,
            status: recovered.status,
            existing: true,
          };
      }
      let key: string | null = null;
      try {
        const content = typeof bytes === "function" ? await bytes() : bytes;
        if (content) key = await this.pending.write(content);
        const result = await this.reserve(
          identity,
          requestId,
          hash,
          input,
          key,
        );
        if (result.created) this.identities.set(result.run.id, identity);
        this.wake();
        return {
          runId: result.run.id,
          status: result.run.status,
          existing: !result.created,
        };
      } finally {
        // A response/commit failure is not proof of rollback. Keep committed inputs.
        if (
          key &&
          !(await this.db.prisma.fileRun.findUnique({
            where: { inputKey: key },
            select: { id: true },
          }))
        )
          await this.pending.removeIfPresent(key);
      }
    });
  }
  async upload(
    token: string | undefined,
    context: AdministratorContext,
    request: unknown,
    name: string,
    body: Buffer,
    target?: string,
  ) {
    const requestId = fileRequestId(request),
      bytes = Buffer.from(body);
    fileFormat(name);
    if (!bytes.length || bytes.length > FILE_LIMITS.bytes)
      throw new FileError("file_too_large");
    const hash = createHash("sha256").update(bytes).digest("hex"),
      identity = { token, context };
    const signature = fingerprint([
      target ? "replace" : "register",
      target ? originalId(target) : null,
      name,
      hash,
    ]);
    const input = await this.scoped(identity, async (tx, c): Promise<Input> => {
      const old = await this.request(tx, c, requestId, signature);
      if (old)
        return {
          operation: target ? "replace" : "register",
          trigger: "duplicate",
          name,
          hash,
          size: bytes.length,
        };
      if (!target)
        return {
          operation: "register",
          trigger: "register",
          name,
          hash,
          size: bytes.length,
        };
      const current = await this.target(tx, c, originalId(target));
      return {
        operation: "replace",
        trigger: "replace",
        name,
        hash,
        size: bytes.length,
        target: current.original.id,
        base: current.version.id,
      };
    });
    return this.acknowledged(identity, requestId, signature, input, bytes);
  }
  async index(
    token: string | undefined,
    context: AdministratorContext,
    request: unknown,
    id: string,
  ) {
    const requestId = fileRequestId(request),
      identity = { token, context },
      target = originalId(id),
      hash = fingerprint(["index", target]);
    const old = await this.scoped(identity, (tx, c) =>
      this.request(tx, c, requestId, hash),
    );
    if (old) return { runId: old.id, status: old.status, existing: true };
    const input = await this.scoped(identity, async (tx, c): Promise<Input> => {
      const current = await this.target(tx, c, target);
      return {
        operation: "index",
        trigger: "index",
        name: current.version.fileName,
        hash: current.version.contentHash,
        size: current.version.byteSize,
        target,
        base: current.version.id,
      };
    });
    return this.acknowledged(identity, requestId, hash, input);
  }
  async reprocess(
    token: string | undefined,
    context: AdministratorContext,
    request: unknown,
    id: string,
  ) {
    const requestId = fileRequestId(request),
      identity = { token, context },
      target = originalId(id);
    const hash = fingerprint(["reprocess", target]);
    const old = await this.scoped(identity, (tx, c) =>
      this.request(tx, c, requestId, hash),
    );
    if (old) return { runId: old.id, status: old.status, existing: true };
    const input = await this.scoped(identity, async (tx, c): Promise<Input> => {
      const current = await this.target(tx, c, target);
      return {
        operation: "reprocess",
        trigger: "reprocess",
        name: current.version.fileName,
        hash: current.version.contentHash,
        size: current.version.byteSize,
        target,
        base: current.version.id,
      };
    });
    return this.acknowledged(identity, requestId, hash, input);
  }
  async retry(
    token: string | undefined,
    context: AdministratorContext,
    request: unknown,
    id: string,
  ) {
    const requestId = fileRequestId(request),
      identity = { token, context },
      retryOf = originalId(id),
      hash = fingerprint(["retry", retryOf]);
    const source = await this.scoped(identity, async (tx, c) => {
      const old = await this.request(tx, c, requestId, hash);
      if (old) return { old, run: null };
      const run = await this.owned(tx, c, retryOf);
      const family =
        run.operation === "register" && run.resultVersionId == null
          ? run.targetKey
          : undefined;
      const recovered = await tx.fileRun.findFirst({
        where: {
          ...this.where(c),
          status: "succeeded",
          AND: [
            this.retained(),
            {
              OR: [
                { retryOfId: run.id },
                ...(family ? [{ targetKey: family }] : []),
              ],
            },
          ],
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      });
      if (recovered) {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(741126, 6)::text`;
        const replay = await this.request(tx, c, requestId, hash);
        if (!replay)
          await tx.fileRunRequest.create({
            data: {
              installationId: c.installationId,
              requestId,
              runId: recovered.id,
              fingerprint: hash,
            },
          });
        return { old: replay ?? recovered, run: null };
      }
      if (run.errorCode === "sensitive_file")
        throw new ConflictException({ code: "retry_input_unavailable" });
      if (!["failed", "interrupted"].includes(run.status))
        throw new ConflictException({ code: "run_not_retryable" });
      return { old: null, run };
    });
    if (source.old)
      return {
        runId: source.old.id,
        status: source.old.status,
        existing: true,
      };
    const parent = source.run!;
    const target = parent.resultOriginalId ?? parent.targetOriginalId;
    const base = parent.resultVersionId ?? parent.baseVersionId;
    if (target)
      await this.scoped(identity, async (tx, c) => {
        if ((await this.target(tx, c, target)).version.id !== base)
          throw new ConflictException({ code: "source_changed" });
      });
    // Once a version exists, its persistent original is authoritative. A pending
    // duplicate may already be removed by cleanup before this retry is admitted.
    const inputKey = parent.resultVersionId ? null : parent.inputKey;
    const load = inputKey
      ? async () => {
          const bytes = await this.pending.read(inputKey);
          if (
            bytes.length !== parent.byteSize ||
            createHash("sha256").update(bytes).digest("hex") !==
              parent.contentHash
          )
            throw new FileError("storage_unavailable");
          return bytes;
        }
      : undefined;
    if (
      !inputKey &&
      !parent.resultVersionId &&
      !["reprocess", "index"].includes(parent.operation)
    )
      throw new ConflictException({ code: "retry_input_unavailable" });
    const operation = parent.resultVersionId
      ? "reprocess"
      : (parent.operation as Input["operation"]);
    return this.acknowledged(
      identity,
      requestId,
      hash,
      {
        operation,
        trigger: "retry",
        name: parent.fileName,
        hash: parent.contentHash,
        size: parent.byteSize,
        ...(target ? { target } : {}),
        ...(base ? { base } : {}),
        retryOf,
        ...(operation === "register" ? { family: parent.targetKey } : {}),
      },
      load,
    );
  }
  async stop(
    token: string | undefined,
    context: AdministratorContext,
    id: string,
  ) {
    id = originalId(id);
    const row = await this.scoped({ token, context }, async (tx, c) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(741126, 6)::text`;
      const run = await this.owned(tx, c, id);
      if (run.status === "interrupted") return run;
      if (!ACTIVE.includes(run.status))
        throw new ConflictException({ code: "run_already_completed" });
      const changed = await tx.fileRun.updateMany({
        where: { id, status: { in: ACTIVE } },
        data: {
          status: "interrupted",
          errorCode: "user_stopped",
          completedAt: await clock(tx),
        },
      });
      if (changed.count !== 1)
        throw new ConflictException({ code: "run_already_completed" });
      return run;
    });
    if (this.active === id) {
      this.activeCancellation?.abort();
      this.extractor.cancel();
    }
    this.identities.delete(id);
    return { runId: row.id, status: "interrupted" };
  }
  private wake() {
    if (this.closing || this.task) return;
    this.task = new Promise<void>((resolve) => setImmediate(resolve))
      .then(() => this.drain())
      .catch(() => {
        Logger.error("TOWNBASE_FILE_RUN_PROCESSING_FAILED");
      })
      .finally(() => {
        this.task = undefined;
      });
  }
  private async drain() {
    while (!this.closing) {
      await this.checkOwner();
      // An idle poll must not take the file-operation lock and reject normal deletes.
      if (
        !(await this.db.prisma.fileRun.findFirst({
          where: { status: "queued" },
          select: { id: true },
        }))
      )
        break;
      let claimed = false;
      let claimedId: string | undefined;
      try {
        await this.files.withFileOperation(async () => {
          const run = await this.db.prisma.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT pg_advisory_xact_lock(741126, 6)::text`;
            if (this.closing) return null;
            const queued = await tx.fileRun.findFirst({
              where: { status: "queued" },
              orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            });
            if (!queued) return null;
            const changed = await tx.fileRun.updateMany({
              where: { id: queued.id, status: "queued" },
              data: { status: "running", startedAt: await clock(tx) },
            });
            return changed.count === 1 ? queued : null;
          });
          if (!run) return;
          claimed = true;
          claimedId = run.id;
          this.active = run.id;
          const cancellation = new AbortController();
          this.activeCancellation = cancellation;
          if (this.closing) cancellation.abort();
          const monitor = setInterval(() => {
            void this.db.prisma.fileRun
              .findUnique({ where: { id: run.id }, select: { status: true } })
              .then((row) => {
                if (this.active === run.id && row?.status !== "running") {
                  cancellation.abort();
                  this.extractor.cancel();
                }
              })
              .catch(() => {
                if (this.active === run.id) {
                  cancellation.abort();
                  this.extractor.cancel();
                }
              });
          }, 250);
          try {
            await this.execute(run, cancellation.signal);
          } finally {
            clearInterval(monitor);
            this.active = undefined;
            this.activeCancellation = undefined;
            this.identities.delete(run.id);
          }
        });
      } catch (error) {
        if (error instanceof ConflictException) break; // Still queued; no execution/retry occurred.
        throw error;
      }
      if (!claimed) break;
      await this.staging(() => this.cleanup(claimedId)).catch(
        (error: unknown) => {
          if (!(error instanceof ConflictException))
            Logger.error("TOWNBASE_FILE_RUN_CLEANUP_FAILED");
        },
      );
    }
    if (Date.now() >= this.nextCleanupAt) {
      this.nextCleanupAt = Date.now() + 60_000;
      await this.staging(() => this.cleanup()).catch((error: unknown) => {
        if (error instanceof ConflictException)
          this.nextCleanupAt = Date.now() + 1000;
        else Logger.error("TOWNBASE_FILE_RUN_CLEANUP_FAILED");
      });
    }
  }
  private async complete(
    tx: Tx,
    run: Run,
    value: {
      originalId: string;
      versionId: string;
      status: string;
      errorCode: string | null;
      extractionRunId: string;
    },
    unchanged = false,
  ) {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(741126, 6)::text`;
    await this.checkOwner();
    const success = value.status === "extracted";
    const count = await tx.fileRun.updateMany({
      where: { id: run.id, status: "running" },
      data: {
        status: success ? "succeeded" : "failed",
        errorCode: value.errorCode,
        completedAt: await clock(tx),
        resultOriginalId: value.originalId,
        resultVersionId: value.versionId,
        resultExtractionRunId: value.extractionRunId,
        createdCount: success && run.operation === "register" ? 1 : 0,
        updatedCount:
          success && run.operation !== "register" && !unchanged ? 1 : 0,
        unchangedCount: success && unchanged ? 1 : 0,
        failedCount: success ? 0 : 1,
      },
    });
    if (count.count !== 1)
      throw new ConflictException({ code: "run_no_longer_active" });
  }
  private async execute(run: Run, signal: AbortSignal) {
    const identity = this.identities.get(run.id);
    try {
      if (!identity) throw new UnauthorizedException();
      if (run.targetOriginalId)
        await this.scoped(identity, async (tx, c) => {
          if (
            (await this.target(tx, c, run.targetOriginalId!)).version.id !==
            run.baseVersionId
          )
            throw new ConflictException({ code: "source_changed" });
        });
      if (run.operation === "index") {
        await this.indexing.execute(
          identity.token,
          identity.context,
          run,
          signal,
          async (tx, c) => {
            await this.checkOwner();
            const active = await tx.fileRun.findFirst({
              where: { id: run.id, ...this.where(c), status: "running" },
            });
            if (!active || signal.aborted)
              throw new ModelCallError("call_cancelled", 409);
          },
          (tx, value, unchanged) => this.complete(tx, run, value, unchanged),
        );
      } else if (run.operation === "reprocess") {
        {
          const current = await this.scoped(identity, async (tx, c) =>
            this.target(tx, c, run.targetOriginalId!),
          );
          if (current.version.id !== run.baseVersionId)
            throw new ConflictException({ code: "source_changed" });
          const bytes = run.inputKey
            ? await this.pending.read(run.inputKey)
            : await this.files.storage.read(current.version.storageKey);
          if (
            bytes.length !== run.byteSize ||
            createHash("sha256").update(bytes).digest("hex") !== run.contentHash
          )
            throw new FileError("storage_unavailable");
          let extraction:
              | Awaited<ReturnType<FileExtractor["extract"]>>
              | undefined,
            code: string | null = null;
          try {
            extraction = await this.extractor.extract(
              run.fileName,
              bytes,
              signal,
            );
          } catch (error) {
            if (
              !(error instanceof FileError) ||
              [
                "parser_busy",
                "parser_unavailable",
                "storage_unavailable",
                "extraction_cancelled",
              ].includes(error.code)
            )
              throw error;
            code = error.code;
          }
          if (extraction) this.inspect(extraction, run.fileName);
          await this.scoped(identity, async (tx, c) => {
            const latest = await this.target(tx, c, run.targetOriginalId!);
            if (latest.version.id !== run.baseVersionId)
              throw new ConflictException({ code: "source_changed" });
            if (extraction)
              await tx.fileVersion.update({
                where: { id: latest.version.id },
                data: {
                  extraction: extraction as unknown as Prisma.InputJsonValue,
                },
              });

            const extractionRun = await tx.fileExtractionRun.create({
              data: {
                id: randomUUID(),
                installationId: c.installationId,
                versionId: latest.version.id,
                status: extraction ? "extracted" : "failed",
                errorCode: code,
                startedAt: (
                  await tx.fileRun.findUniqueOrThrow({ where: { id: run.id } })
                ).startedAt!,
                completedAt: await clock(tx),
              },
            });
            await this.complete(
              tx,
              run,
              {
                originalId: latest.original.id,
                versionId: latest.version.id,
                status: extraction ? "extracted" : "failed",
                errorCode: code,
                extractionRunId: extractionRun.id,
              },
              extraction != null &&
                isDeepStrictEqual(extraction, latest.version.extraction),
            );
            return {};
          });
        }
      } else {
        if (!run.inputKey) throw new FileError("storage_unavailable");
        const bytes = await this.pending.read(run.inputKey);
        if (
          bytes.length !== run.byteSize ||
          createHash("sha256").update(bytes).digest("hex") !== run.contentHash
        )
          throw new FileError("storage_unavailable");
        await this.files.persistUpload(
          identity.token,
          identity.context,
          run.fileName,
          bytes,
          run.targetOriginalId ?? undefined,
          (tx, result) =>
            this.complete(tx, run, {
              ...result,
              extractionRunId: result.runId,
            }),
          run.baseVersionId ?? undefined,
          signal,
        );
      }
    } catch (error) {
      const code =
        error instanceof TransferDenied
          ? error.code === "sensitive_content"
            ? "sensitive_file"
            : error.code
          : error instanceof ModelCallError ||
              error instanceof CredentialStorageError
            ? error.code
            : error instanceof FileError
              ? error.code
              : error instanceof UnauthorizedException
                ? "authorization_expired"
                : error instanceof NotFoundException
                  ? "source_unavailable"
                  : error instanceof ConflictException
                    ? (error.getResponse() as { code?: string }).code ===
                      "source_changed"
                      ? "source_changed"
                      : "processing_conflict"
                    : "storage_unavailable";
      await this.db.prisma.fileRun.updateMany({
        where: { id: run.id, status: "running" },
        data: {
          status: code === "source_unavailable" ? "interrupted" : "failed",
          errorCode: code,
          failedCount: code === "source_unavailable" ? 0 : 1,
          excludedCount: code === "source_unavailable" ? 1 : 0,
          completedAt: new Date(),
        },
      });
    }
  }
  private inspect(
    extraction: Awaited<ReturnType<FileExtractor["extract"]>>,
    name: string,
  ) {
    assertExtraction(extraction, fileFormat(name));
    inspectTransfer(
      { documentEmbedding: true, rag: false, attachment: false },
      "document_embedding",
      OPENAI_ENDPOINTS.embedding,
      extraction.segments.map((s) => s.text).join("\n"),
      [name],
    );
  }
  private async cleanup(onlyId?: string) {
    const cutoff = new Date(Date.now() - RETENTION_MS);
    let cursor: string | undefined;
    while (true) {
      const rows = await this.db.prisma.fileRun.findMany({
        where: {
          ...(onlyId ? { id: onlyId } : {}),
          inputKey: { not: null },
          ...(cursor ? { id: { gt: cursor } } : {}),
        },
        orderBy: { id: "asc" },
        take: 100,
      });
      if (!rows.length) break;
      for (const run of rows) {
        const target = run.resultOriginalId ?? run.targetOriginalId;
        const source = target
          ? await this.db.prisma.fileOriginal.findUnique({
              where: { id: target },
              select: { deletedAt: true },
            })
          : null;
        const removed =
          target != null && (source == null || source.deletedAt != null);
        const recovered =
          run.operation === "register" &&
          !ACTIVE.includes(run.status) &&
          run.resultVersionId == null
            ? await this.db.prisma.fileRun.findFirst({
                where: {
                  installationId: run.installationId,
                  targetKey: run.targetKey,
                  status: "succeeded",
                },
                select: { id: true },
              })
            : null;
        const discard =
          recovered != null ||
          run.resultVersionId != null ||
          run.errorCode === "sensitive_file" ||
          removed ||
          (run.completedAt != null && run.completedAt <= cutoff);
        if (discard && run.inputKey) {
          await this.pending.removeIfPresent(run.inputKey);
          await this.db.prisma.fileRun.updateMany({
            where: { id: run.id, inputKey: run.inputKey, status: run.status },
            data: {
              inputKey: null,
              ...(ACTIVE.includes(run.status) && removed
                ? {
                    status: "interrupted",
                    errorCode: "source_unavailable",
                    excludedCount: 1,
                    completedAt: new Date(),
                  }
                : {}),
            },
          });
        }
      }
      cursor = rows[rows.length - 1]!.id;
    }
    if (onlyId) return;
    for await (const key of this.pending.keys()) {
      if (
        !(await this.db.prisma.fileRun.findUnique({
          where: { inputKey: key },
          select: { id: true },
        }))
      )
        await this.pending.removeIfPresent(key);
    }
    while (true) {
      const rows = await this.db.prisma.fileRun.findMany({
        where: { completedAt: { lte: cutoff }, inputKey: null },
        select: { id: true },
        take: 100,
      });
      if (!rows.length) break;
      const ids = rows.map((r) => r.id);
      await this.db.prisma.$transaction(async (tx) => {
        await tx.fileRunRequest.deleteMany({ where: { runId: { in: ids } } });
        await tx.fileRun.deleteMany({
          where: {
            id: { in: ids },
            completedAt: { lte: cutoff },
            inputKey: null,
          },
        });
      });
    }
  }
}
