import {
  Injectable,
  OnApplicationBootstrap,
  UnauthorizedException,
  NotFoundException,
} from "@nestjs/common";
import { open } from "node:fs/promises";
import path from "node:path";
import { AuthService, type AdministratorContext } from "../auth/auth.service";
import { DeploymentDatabase } from "../deployment/deployment-database";
import { FileStorage } from "../files/file-storage";
import {
  ModelCallError,
  validRequestId,
} from "../model-integration/model-policy";
import { randomUUID } from "node:crypto";
export function operationsPath() {
  return (
    process.env.TOWNBASE_OPERATIONS_PATH ??
    path.join(
      path.dirname(
        process.env.TOWNBASE_DOCUMENTS_PATH ?? "/var/lib/townbase/documents",
      ),
      "operations",
    )
  );
}
export type DeletionKind =
  | "file"
  | "file_scope"
  | "gap"
  | "conversation"
  | "private_result";
export type DeletionRecord = {
  version: 1;
  id: string;
  installationId: string;
  workspaceId: string;
  ownerAdministratorId: string;
  kind: DeletionKind;
  targetId: string;
  scopeRevision: number | null;
  createdAt: string;
};
export function parseDeletion(value: unknown): DeletionRecord {
  if (value == null || typeof value !== "object" || Array.isArray(value))
    throw new ModelCallError("deletion_journal_unavailable", 503);
  const r = value as DeletionRecord;
  if (
    Object.keys(r).sort().join(",") !==
      [
        "version",
        "id",
        "installationId",
        "workspaceId",
        "ownerAdministratorId",
        "kind",
        "targetId",
        "scopeRevision",
        "createdAt",
      ]
        .sort()
        .join(",") ||
    r.version !== 1 ||
    !validRequestId(r.id) ||
    !validRequestId(r.targetId) ||
    !["file", "file_scope", "gap", "conversation", "private_result"].includes(
      r.kind,
    ) ||
    ![r.installationId, r.workspaceId, r.ownerAdministratorId].every(
      (s) => typeof s === "string" && s.length > 0 && s.length <= 128,
    ) ||
    typeof r.createdAt !== "string" ||
    !Number.isFinite(Date.parse(r.createdAt)) ||
    (r.kind === "file_scope"
      ? !Number.isSafeInteger(r.scopeRevision) || r.scopeRevision! < 2
      : r.scopeRevision !== null)
  )
    throw new ModelCallError("deletion_journal_unavailable", 503);
  return r;
}
@Injectable()
export class DeletionJournal implements OnApplicationBootstrap {
  private readonly root = path.join(operationsPath(), "deletions");
  readonly storage = new FileStorage(this.root);
  constructor(
    private readonly db: DeploymentDatabase,
    private readonly auth: AuthService,
  ) {}
  async onApplicationBootstrap() {
    await this.replay();
  }
  async records() {
    const records: DeletionRecord[] = [];
    for await (const key of this.storage.keys()) {
      const bytes = await this.storage.read(key, 4096);
      if (bytes.length > 4096)
        throw new ModelCallError("deletion_journal_unavailable", 503);
      records.push(parseDeletion(JSON.parse(bytes.toString("utf8"))));
    }
    return records.sort(
      (a, b) =>
        a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    );
  }
  async accept(
    token: string | undefined,
    c: AdministratorContext,
    kind: DeletionKind,
    targetId: string,
  ) {
    const authorized = await this.auth.authorizedOperation(
      token,
      c,
      async (tx, fresh) => {
        const scope = {
          installationId: fresh.installationId,
          ownerAdministratorId: fresh.administratorId,
        };
        let revision: number | null = null;
        const exists =
          kind === "file" || kind === "file_scope"
            ? await tx.fileOriginal.findFirst({
                where: { ...scope, id: targetId },
              })
            : kind === "gap"
              ? await tx.ragGap.findFirst({ where: { ...scope, id: targetId } })
              : kind === "conversation"
                ? await tx.ragConversation.findFirst({
                    where: { ...scope, id: targetId },
                  })
                : await tx.attachmentTask.findFirst({
                    where: { ...scope, requestId: targetId },
                  });
        if (!exists) throw new NotFoundException();
        if (kind === "file_scope") {
          if (
            !("scopeRevision" in exists) ||
            !Number.isSafeInteger(exists.scopeRevision) ||
            Number(exists.scopeRevision) >= 2147483647
          )
            throw new ModelCallError("scope_revision_limit", 409);
          revision = Number(exists.scopeRevision) + 1;
        }
        return { fresh, revision };
      },
    );
    if (!authorized.ok) throw new UnauthorizedException();
    const record: DeletionRecord = {
      version: 1,
      id: randomUUID(),
      installationId: authorized.fresh.installationId,
      workspaceId: authorized.fresh.workspaceId,
      ownerAdministratorId: authorized.fresh.administratorId,
      kind,
      targetId,
      scopeRevision: authorized.revision,
      createdAt: new Date().toISOString(),
    };
    // This is an authenticated, durable deletion intent. A crash after fsync but
    // before DB mutation is completed by startup replay, before HTTP is opened.
    await this.storage.write(Buffer.from(JSON.stringify(record)));
    const directory = await open(this.root, "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
    return record;
  }
  async replay() {
    for (const record of await this.records()) await this.apply(record);
  }
  async apply(record: DeletionRecord) {
    await this.db.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "AuthenticationState" WHERE id='primary' FOR UPDATE`;
      const install = await tx.installation.findFirst({
        where: { id: record.installationId, workspaceId: record.workspaceId },
      });
      if (!install) return;
      await tx.$queryRaw`SELECT id FROM "Installation" WHERE id=${install.id} FOR UPDATE`;
      const scope = {
          installationId: record.installationId,
          ownerAdministratorId: record.ownerAdministratorId,
        },
        now = new Date();
      if (record.kind === "file") {
        await tx.fileOriginal.updateMany({
          where: { ...scope, id: record.targetId, deletedAt: null },
          data: { deletedAt: now },
        });
        await tx.fileVersion.updateMany({
          where: {
            installationId: install.id,
            originalId: record.targetId,
            original: { ownerAdministratorId: record.ownerAdministratorId },
          },
          data: { extraction: Prisma.DbNull },
        });
        await tx.fileIndex.deleteMany({
          where: { ...scope, originalId: record.targetId },
        });
      } else if (record.kind === "file_scope") {
        await tx.fileOriginal.updateMany({
          where: {
            ...scope,
            id: record.targetId,
            scopeRevision: { lt: record.scopeRevision! },
          },
          data: { excludedAt: now, scopeRevision: record.scopeRevision! },
        });
        await tx.fileIndex.deleteMany({
          where: {
            ...scope,
            originalId: record.targetId,
            scopeRevision: { lt: record.scopeRevision! },
          },
        });
      } else if (record.kind === "gap")
        await tx.ragGap.deleteMany({
          where: { ...scope, id: record.targetId },
        });
      else if (record.kind === "conversation") {
        const turns = await tx.ragTurn.findMany({
          where: { ...scope, conversationId: record.targetId },
          select: { requestId: true },
        });
        await tx.ragGap.deleteMany({
          where: {
            ...scope,
            turnRequestId: { in: turns.map((t) => t.requestId) },
          },
        });
        await tx.ragTurn.deleteMany({
          where: { ...scope, conversationId: record.targetId },
        });
        await tx.ragConversation.deleteMany({
          where: { ...scope, id: record.targetId },
        });
      } else {
        await tx.attachment.deleteMany({
          where: { ...scope, taskRequestId: record.targetId },
        });
        await tx.attachmentTask.deleteMany({
          where: { ...scope, requestId: record.targetId },
        });
      }
    });
  }
}
import { Prisma } from "@townbase/database";
