import { createRequire } from "node:module";
import {
  mkdir,
  writeFile,
  readFile,
  lstat,
  realpath,
  open,
  unlink,
  rename,
  access,
} from "node:fs/promises";
import { createWriteStream, existsSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { databaseEnvironment } from "./database-env.mjs";
import { privateDirectory, fileHash, pruneBackups } from "./backup-format.mjs";
const root =
    process.env.TOWNBASE_OPERATIONS_PATH ?? "/var/lib/townbase/operations",
  documents =
    process.env.TOWNBASE_DOCUMENTS_PATH ?? "/var/lib/townbase/documents",
  action = process.argv[2];
const atomic = async (name, value) => {
  const filename = path.join(root, name),
    temporary = filename + "." + randomUUID();
  const h = await open(temporary, "wx", 0o600);
  try {
    await h.writeFile(JSON.stringify(value) + "\n");
    await h.sync();
  } finally {
    await h.close();
  }
  await rename(temporary, filename);
  const d = await open(root, "r");
  try {
    await d.sync();
  } finally {
    await d.close();
  }
};
async function input() {
  const chunks = [];
  let size = 0;
  for await (const c of process.stdin) {
    size += c.length;
    if (size > 16 * 1024 * 1024) throw Error("Input too large");
    chunks.push(c);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
try {
  await privateDirectory(root);
  if (action === "prepare") {
    try {
      await writeFile(
        path.join(root, "restore-pending"),
        "Restore verification required\n",
        { flag: "wx", mode: 0o600 },
      );
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
    }
    const d = await open(root, "r");
    try {
      await d.sync();
    } finally {
      await d.close();
    }
  } else if (action === "prepare-documents") {
    await access(path.join(root, "restore-pending"));
    await privateDirectory(documents);
    for (const name of ["originals", "pending"])
      await privateDirectory(path.join(documents, name));
  } else if (action === "document") {
    await access(path.join(root, "restore-pending"));
    const key = process.argv[3];
    if (!/^(originals|pending)\/[0-9a-f-]{36}\.bin$/.test(key ?? ""))
      throw Error("Invalid restore document");
    await privateDirectory(path.join(documents, path.dirname(key)));
    const filename = path.join(documents, key);
    const h = await open(filename, "wx", 0o600);
    await h.close();
    let bytes = 0;
    try {
      const bound = new Transform({
        transform(chunk, _encoding, callback) {
          bytes += chunk.length;
          callback(
            bytes > 20 * 1024 * 1024 ? Error("Restore file limit") : null,
            chunk,
          );
        },
      });
      await pipeline(
        process.stdin,
        bound,
        createWriteStream(filename, { flags: "r+" }),
      );
      const file = await open(filename, "r");
      try {
        await file.sync();
      } finally {
        await file.close();
      }
      const d = await open(path.dirname(filename), "r");
      try {
        await d.sync();
      } finally {
        await d.close();
      }
    } catch (e) {
      await unlink(filename).catch(() => {});
      throw e;
    }
  } else if (action === "backup-import") {
    const name = process.argv[3];
    if (!/^townbase-[0-9TZ-]+-[0-9a-f-]{36}\.tbk$/.test(name ?? ""))
      throw Error("Invalid backup name");
    const directory = await privateDirectory(path.join(root, "backups"));
    const filename = path.join(directory, name);
    const handle = await open(filename, "wx", 0o600);
    await handle.close();
    try {
      await pipeline(
        process.stdin,
        createWriteStream(filename, { flags: "r+" }),
      );
      const file = await open(filename, "r");
      try {
        await file.sync();
      } finally {
        await file.close();
      }
    } catch (e) {
      await unlink(filename).catch(() => {});
      throw e;
    }
  } else if (action === "backup-record") {
    const value = await input();
    if (
      typeof value.createdAt !== "string" ||
      !Number.isFinite(Date.parse(value.createdAt)) ||
      !/^townbase-[0-9TZ-]+-[0-9a-f-]{36}\.tbk$/.test(value.name ?? "") ||
      !/^[0-9a-f]{64}$/.test(value.sha256 ?? "")
    )
      throw Error("Invalid backup status");
    const filename = path.join(root, "backups", value.name);
    const s = await lstat(filename);
    if (
      !s.isFile() ||
      s.isSymbolicLink() ||
      (await fileHash(filename)) !== value.sha256
    )
      throw Error("Invalid backup copy");
    const h = await open(filename, "r");
    try {
      await h.sync();
    } finally {
      await h.close();
    }
    await atomic("backup-state.json", {
      createdAt: value.createdAt,
      name: value.name,
    });
    await pruneBackups(path.join(root, "backups"));
  } else if (action === "verify") {
    await access(path.join(root, "restore-pending"));
    const value = await input();
    if (value.version !== 1 || !Array.isArray(value.records))
      throw Error("Invalid restore metadata");
    process.env.DATABASE_URL = databaseEnvironment();
    process.env.TOWNBASE_RESTORE_MAINTENANCE = "1";
    const requireApi = createRequire(
      new URL(
        existsSync(new URL("../api/package.json", import.meta.url))
          ? "../api/package.json"
          : "../apps/api/package.json",
        import.meta.url,
      ),
    );
    const { DeletionJournal, parseDeletion } = requireApi(
      "./dist/operations/deletion-journal.js",
    );
    const { FileStorage } = requireApi("./dist/files/file-storage.js");
    const storage = new FileStorage(path.join(root, "deletions"));
    const existing = new Map();
    for await (const key of storage.keys()) {
      const r = parseDeletion(
        JSON.parse((await storage.read(key, 4096)).toString("utf8")),
      );
      existing.set(r.id, JSON.stringify(r));
    }
    const parsed = value.records.map(parseDeletion);
    for (const record of parsed) {
      const encoded = JSON.stringify(record);
      if (existing.has(record.id)) {
        if (existing.get(record.id) !== encoded)
          throw Error("Conflicting deletion record");
        continue;
      }
      if (Buffer.byteLength(encoded) > 4096)
        throw Error("Deletion record too large");
      await storage.write(Buffer.from(encoded));
      existing.set(record.id, encoded);
    }
    const dir = await open(path.join(root, "deletions"), "r");
    try {
      await dir.sync();
    } finally {
      await dir.close();
    }
    const { NestFactory } = requireApi("@nestjs/core"),
      { DeploymentModule } = requireApi(
        "./dist/deployment/deployment.module.js",
      ),
      { DeploymentDatabase } = requireApi(
        "./dist/deployment/deployment-database.js",
      ),
      { CredentialVault } = requireApi(
        "./dist/model-integration/credential-vault.js",
      );
    let app;
    try {
      app = await NestFactory.createApplicationContext(DeploymentModule, {
        logger: false,
        abortOnError: false,
      });
      const db = app.get(DeploymentDatabase);
      await app.get(DeletionJournal).replay();
      const health = await db.check();
      if (health.database !== "ready" || health.schema !== "ready")
        throw Error("Restore schema not ready");
      const vault = app.get(CredentialVault);
      for (const credential of await db.prisma.modelCredential.findMany())
        await vault.reveal(
          credential.installationId,
          credential.purpose,
          credential,
        );
      for (const row of await db.prisma.fileVersion.findMany({
        where: { rawDeletedAt: null, original: { deletedAt: null } },
      })) {
        const filename = path.join(documents, "originals", row.storageKey);
        const s = await lstat(filename);
        if (
          !s.isFile() ||
          s.isSymbolicLink() ||
          (s.mode & 0o077) !== 0 ||
          s.size !== row.byteSize ||
          (await fileHash(filename)) !== row.contentHash
        )
          throw Error("Restored original mismatch");
      }
      await atomic("restore-state.json", {
        restoredAt: value.restoredAt,
        backupAt: value.backupAt,
        costReconciliationRequired: true,
      });
      await atomic("backup-state.json", { createdAt: value.backupAt });
    } finally {
      await app?.close();
    }
    await unlink(path.join(root, "restore-pending"));
    const d = await open(root, "r");
    try {
      await d.sync();
    } finally {
      await d.close();
    }
  } else throw Error("Unknown maintenance command");
  console.log("TOWNBASE_MAINTENANCE_COMPLETED");
} catch {
  console.error("TOWNBASE_MAINTENANCE_FAILED");
  process.exit(1);
}
