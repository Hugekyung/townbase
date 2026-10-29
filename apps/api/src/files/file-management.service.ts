import { createHash } from "node:crypto";
import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  OnApplicationShutdown,
  UnauthorizedException,
} from "@nestjs/common";
import { PrismaClient, type Prisma } from "@townbase/database";
import { AuthService, type AdministratorContext } from "../auth/auth.service";
import { DeploymentDatabase } from "../deployment/deployment-database";
import {
  inspectTransfer,
  OPENAI_ENDPOINTS,
} from "../model-integration/transfer-policy";
import { FileFoundation } from "./file-foundation";
import { FileExtractor } from "./file-extractor";
import { FileStorage } from "./file-storage";
import { assertExtraction, FileError, type FileFormat } from "./file-contract";

export const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function originalId(id: string): string {
  if (!UUID.test(id)) throw new NotFoundException();
  return id.toLowerCase();
}
// No generic queue or future plugin system. A cross-process lock serializes disk/DB
// reconciliation with intake and deletion; it is independent of authentication locks.
@Injectable()
export class FileManagementService
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly foundation: FileFoundation;
  private maintenance?: ReturnType<typeof setInterval>;
  private busy = false;
  constructor(
    private readonly db: DeploymentDatabase,
    private readonly auth: AuthService,
    readonly storage: FileStorage,
    extractor: FileExtractor,
  ) {
    this.foundation = new FileFoundation(auth, extractor, storage);
  }
  async onModuleInit() {
    await this.locked(() => this.reconcile());
    this.maintenance = setInterval(() => {
      void this.locked(() => this.reconcile()).catch((error: unknown) => {
        if (!(error instanceof ConflictException))
          Logger.error("TOWNBASE_FILE_CLEANUP_FAILED");
      });
    }, 60_000);
    this.maintenance.unref();
  }
  onApplicationShutdown() {
    clearInterval(this.maintenance);
  }
  private async locked<T>(work: () => Promise<T>): Promise<T> {
    if (this.busy) throw new ConflictException({ code: "file_operation_busy" });
    this.busy = true;
    try {
      // Pin one autocommit connection for the session advisory lock. A parser or
      // large cleanup must not outlive a transaction timeout that releases its lock.
      const url = new URL(process.env.DATABASE_URL!);
      url.searchParams.set("connection_limit", "1");
      const lease = new PrismaClient({
        datasources: { db: { url: url.toString() } },
      });
      try {
        const [lock] = await lease.$queryRaw<
          Array<{ acquired: boolean }>
        >`SELECT pg_try_advisory_lock(741126, 3) AS acquired`;
        if (!lock?.acquired)
          throw new ConflictException({ code: "file_operation_busy" });
        return await work();
      } finally {
        // Closing this dedicated connection releases only this operation's lock.
        await lease.$disconnect();
      }
    } finally {
      this.busy = false;
    }
  }
  private async scoped<T>(
    token: string | undefined,
    expected: AdministratorContext,
    work: (
      tx: Prisma.TransactionClient,
      context: AdministratorContext,
    ) => Promise<T>,
  ): Promise<T> {
    const result = await this.auth.authorizedOperation(
      token,
      expected,
      async (tx, context) => ({ value: await work(tx, context) }),
    );
    if (!result.ok) throw new UnauthorizedException();
    return result.value;
  }
  private where(context: AdministratorContext) {
    return {
      installationId: context.installationId,
      ownerAdministratorId: context.administratorId,
      deletedAt: null,
    };
  }
  private async current(
    tx: Prisma.TransactionClient,
    context: AdministratorContext,
    id: string,
  ) {
    const row = await tx.fileOriginal.findFirst({
      where: { ...this.where(context), id },
      include: {
        versions: {
          orderBy: { version: "desc" },
          take: 1,
          include: { runs: { orderBy: { completedAt: "desc" }, take: 1 } },
        },
      },
    });
    if (!row || !row.versions[0]) throw new NotFoundException();
    return row;
  }
  private summary(
    version: Prisma.FileVersionGetPayload<{ include: { runs: true } }>,
  ) {
    const {
      storageKey: _key,
      extraction: _extraction,
      rawDeletedAt: _deleted,
      ...safe
    } = version;
    void _key;
    void _extraction;
    void _deleted;
    return { ...safe, searchable: false };
  }
  async list(
    token: string | undefined,
    context: AdministratorContext,
    cursor?: string,
  ) {
    if (cursor) cursor = originalId(cursor);
    return this.scoped(token, context, async (tx, c) => {
      const rows = await tx.fileOriginal.findMany({
        where: { ...this.where(c), ...(cursor ? { id: { gt: cursor } } : {}) },
        orderBy: { id: "asc" },
        take: 21,
        include: {
          versions: {
            orderBy: { version: "desc" },
            take: 1,
            include: { runs: { orderBy: { completedAt: "desc" }, take: 1 } },
          },
        },
      });
      return {
        items: rows.slice(0, 20).map(({ versions, ...original }) => ({
          ...original,
          version: versions[0] ? this.summary(versions[0]) : null,
        })),
        nextCursor: rows.length > 20 ? rows[19]!.id : null,
      };
    });
  }
  async read(
    token: string | undefined,
    context: AdministratorContext,
    id: string,
  ) {
    id = originalId(id);
    return this.scoped(token, context, async (tx, c) => {
      const { versions, ...original } = await this.current(tx, c, id);
      const version = versions[0]!;
      if (version.extraction != null)
        assertExtraction(version.extraction, version.format as FileFormat);
      return {
        ...original,
        version: { ...this.summary(version), extraction: version.extraction },
        reference: `/files/${id}/reference`,
      };
    });
  }
  async reference(
    token: string | undefined,
    context: AdministratorContext,
    id: string,
  ) {
    id = originalId(id);
    const load = () =>
      this.scoped(
        token,
        context,
        async (tx, c) => (await this.current(tx, c, id)).versions[0]!,
      );
    const version = await load();
    if (version.rawDeletedAt != null) throw new NotFoundException();
    const bytes = await this.storage.read(version.storageKey);
    if (
      bytes.length !== version.byteSize ||
      createHash("sha256").update(bytes).digest("hex") !== version.contentHash
    )
      throw new FileError("storage_unavailable");
    // Recheck the latest session, tombstone and current version after disk I/O.
    const latest = await load();
    if (latest.id !== version.id || latest.rawDeletedAt != null)
      throw new NotFoundException();
    return { bytes, name: version.fileName };
  }
  async register(
    token: string | undefined,
    context: AdministratorContext,
    name: string,
    bytes: Buffer,
    replaceId?: string,
  ) {
    if (replaceId) replaceId = originalId(replaceId);
    return this.locked(async () => {
      // Reconcile first. Do not expose intake if prior orphan/deletion cleanup failed.
      await this.reconcile();
      try {
        const ids = await this.foundation.create(token, context, name, bytes, {
          ...(replaceId ? { replaceId } : {}),
          preserveOnFailure: true,
          audit: true,
          inspect: (value) =>
            inspectTransfer(
              { documentEmbedding: true, rag: false, attachment: false },
              "document_embedding",
              OPENAI_ENDPOINTS.embedding,
              value.segments.map((s) => s.text).join("\n"),
              [name],
            ),
        });
        return this.read(token, context, ids.originalId);
      } finally {
        // Query authoritative committed rows before removing an uncertain write.
        // A lost DB connection leaves files for a future retry, never deletes blindly.
        await this.reconcile();
      }
    });
  }
  async remove(
    token: string | undefined,
    context: AdministratorContext,
    id: string,
  ) {
    id = originalId(id);
    return this.locked(async () => {
      await this.scoped(token, context, async (tx, c) => {
        const found = await tx.fileOriginal.findFirst({
          where: {
            id,
            installationId: c.installationId,
            ownerAdministratorId: c.administratorId,
          },
        });
        if (!found) throw new NotFoundException();
        if (found.deletedAt == null)
          await tx.fileOriginal.update({
            where: { id },
            data: { deletedAt: new Date() },
          });
        // Clear derived text in the same transaction as access revocation.
        await tx.$executeRaw`UPDATE "FileVersion" SET extraction = NULL WHERE "originalId" = ${id}::uuid AND "installationId" = ${c.installationId}`;
        if (found.deletedAt == null)
          await tx.installationAuditEvent.create({
            data: {
              installationId: c.installationId,
              actorType: "administrator",
              actorAdministratorId: c.administratorId,
              action: "file_deleted",
              outcome: "succeeded",
              requestId: id,
            },
          });
        return {};
      });
      try {
        await this.reconcile();
      } catch {
        Logger.error("TOWNBASE_FILE_CLEANUP_FAILED");
        return { deleted: true, cleanup: "pending" as const };
      }
      return { deleted: true, cleanup: "complete" as const };
    });
  }
  // Caller must hold the file-operation lock. Internal cleanup is independent of a
  // user's now-expired session, and never returns storage keys to a requester.
  private async reconcile() {
    while (true) {
      const rows = await this.db.prisma.fileVersion.findMany({
        where: { rawDeletedAt: null, original: { deletedAt: { not: null } } },
        select: { id: true, storageKey: true },
        orderBy: { id: "asc" },
        take: 100,
      });
      if (rows.length === 0) break;
      for (const row of rows) {
        await this.storage.removeIfPresent(row.storageKey);
        await this.db.prisma
          .$executeRaw`UPDATE "FileVersion" SET "rawDeletedAt" = clock_timestamp(), extraction = NULL WHERE id = ${row.id}::uuid`;
      }
    }
    for await (const key of this.storage.keys()) {
      const row = await this.db.prisma.fileVersion.findUnique({
        where: { storageKey: key },
        select: { original: { select: { deletedAt: true } } },
      });
      if (!row || row.original.deletedAt != null)
        await this.storage.removeIfPresent(key);
    }
  }
}
