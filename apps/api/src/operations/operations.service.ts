import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
  UnauthorizedException,
} from "@nestjs/common";
import {
  readFile,
  statfs,
  mkdir,
  lstat,
  realpath,
  readdir,
  unlink,
  access,
} from "node:fs/promises";
import path from "node:path";
import { DeploymentDatabase } from "../deployment/deployment-database";
import { AuthService, type AdministratorContext } from "../auth/auth.service";
import { DeletionJournal, operationsPath } from "./deletion-journal";
@Injectable()
export class OperationsService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private timer?: ReturnType<typeof setInterval>;
  constructor(
    private readonly db: DeploymentDatabase,
    private readonly auth: AuthService,
    private readonly journal: DeletionJournal,
  ) {}
  async onApplicationBootstrap() {
    if (process.env.TOWNBASE_RESTORE_MAINTENANCE !== "1") {
      let restoring = false;
      try {
        await access(path.join(operationsPath(), "restore-pending"));
        restoring = true;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
      if (restoring) throw new Error("Restore verification required");
    }
    await this.retention();
    this.timer = setInterval(() => {
      void this.retention().catch(() =>
        Logger.error("TOWNBASE_OPERATIONS_CLEANUP_FAILED"),
      );
    }, 60000);
    this.timer.unref();
  }
  onModuleDestroy() {
    clearInterval(this.timer);
  }
  async retention() {
    await this.db.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "AuthenticationState" WHERE id='primary' FOR UPDATE`;
      const cutoff = new Date(Date.now() - 90 * 86400000);
      const old = await tx.installationAuditEvent.findMany({
        where: { occurredAt: { lt: cutoff } },
        select: { id: true },
        take: 200,
      });
      if (old.length)
        await tx.installationAuditEvent.deleteMany({
          where: { id: { in: old.map((r) => r.id) } },
        });
      const sessions = await tx.administratorSession.findMany({
        where: { expiresAt: { lt: cutoff } },
        select: { tokenHash: true },
        take: 200,
      });
      if (sessions.length)
        await tx.administratorSession.deleteMany({
          where: { tokenHash: { in: sessions.map((r) => r.tokenHash) } },
        });
    });
    const backupRoot = path.join(operationsPath(), "backups");
    await mkdir(backupRoot, { recursive: true, mode: 0o700 });
    const backupInfo = await lstat(backupRoot);
    if (
      !backupInfo.isDirectory() ||
      backupInfo.isSymbolicLink() ||
      (backupInfo.mode & 0o077) !== 0 ||
      (await realpath(backupRoot)) !== backupRoot
    )
      throw new Error("Backup storage unavailable");
    const backups: { name: string; time: number }[] = [];
    for (const name of await readdir(backupRoot)) {
      const match =
        /^townbase-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)-[0-9a-f-]{36}\.tbk$/.exec(
          name,
        );
      if (!match) throw new Error("Unexpected backup entry");
      const info = await lstat(path.join(backupRoot, name));
      if (!info.isFile() || info.isSymbolicLink())
        throw new Error("Invalid backup entry");
      backups.push({
        name,
        time: Date.parse(
          match[1]!.replace(
            /T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/,
            "T$1:$2:$3.$4Z",
          ),
        ),
      });
    }
    backups.sort((a, b) => b.time - a.time);
    for (const [i, b] of backups.entries())
      if (i >= 7 || b.time + 7 * 86400000 <= Date.now())
        await unlink(path.join(backupRoot, b.name));
    const root = path.join(operationsPath(), "diagnostics");
    await mkdir(root, { recursive: true, mode: 0o700 });
    const info = await lstat(root);
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      (info.mode & 0o077) !== 0 ||
      (await realpath(root)) !== root
    )
      throw new Error("Operations storage unavailable");
    for (const name of await readdir(root)) {
      if (!/^\d{4}-\d{2}-\d{2}\.log$/.test(name))
        throw new Error("Unexpected diagnostic entry");
      if (Date.parse(name.slice(0, 10)) + 7 * 86400000 <= Date.now())
        await unlink(path.join(root, name));
    }
  }
  async snapshot(token: string | undefined, c: AdministratorContext) {
    const scoped = await this.auth.authorizedOperation(
      token,
      c,
      async (tx, fresh) => {
        const where = {
          installationId: fresh.installationId,
          ownerAdministratorId: fresh.administratorId,
        };
        return {
          counts: {
            documents: await tx.fileOriginal.count({
              where: { ...where, deletedAt: null },
            }),
            ragConversations: await tx.ragConversation.count({ where }),
            privateResults: await tx.attachmentTask.count({ where }),
            temporaryAttachments: await tx.attachment.count({
              where: { ...where, rawDeletedAt: null },
            }),
            pendingAttachmentDeletion: await tx.attachment.count({
              where: { ...where, blockedAt: { not: null }, rawDeletedAt: null },
            }),
            knowledgeGaps: await tx.ragGap.count({ where }),
          },
        };
      },
    );
    if (!scoped.ok) throw new UnauthorizedException({ code: "unauthorized" });
    const disk = async (root: string) => {
      try {
        const s = await statfs(root);
        return {
          availableBytes: Number(s.bavail) * Number(s.bsize),
          capacityBytes: Number(s.blocks) * Number(s.bsize),
        };
      } catch {
        return { availableBytes: null, capacityBytes: null };
      }
    };
    const state = await this.db.check();
    let lastBackupAt: string | null = null;
    try {
      const value = JSON.parse(
        await readFile(
          path.join(operationsPath(), "backup-state.json"),
          "utf8",
        ),
      );
      if (
        typeof value.createdAt === "string" &&
        Number.isFinite(Date.parse(value.createdAt))
      )
        lastBackupAt = value.createdAt;
    } catch {}
    return {
      ...scoped,
      ...state,
      version: process.env.TOWNBASE_VERSION ?? "0.2.0-local",
      lastBackupAt,
      storage: {
        documents: await disk(
          process.env.TOWNBASE_DOCUMENTS_PATH ?? "/var/lib/townbase/documents",
        ),
        attachments: await disk(
          process.env.TOWNBASE_ATTACHMENTS_PATH ??
            "/var/lib/townbase/attachments",
        ),
        operations: await disk(operationsPath()),
      },
      retention: {
        conversationDays: 30,
        privateResultDays: 30,
        runAndAuditDays: 90,
        diagnosticDays: 7,
        temporaryAttachmentMinutes: 60,
        physicalCleanupMinutes: 5,
        backupCopies: 7,
        backupDays: 7,
      },
      deletionJournal: {
        records: (await this.journal.records()).length,
        requiredForRestore: true,
      },
    };
  }
}
