import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { pipeline } from "node:stream/promises";
import { createWriteStream, createReadStream } from "node:fs";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  readdir,
  lstat,
  realpath,
  chmod,
} from "node:fs/promises";
import path from "node:path";
import { randomUUID, randomBytes, timingSafeEqual } from "node:crypto";
import {
  privateDirectory,
  readBackupKey,
  manifestFiles,
  writeBundle,
  encryptBundle,
  decryptBundle,
  unpackBundle,
  pruneBackups,
  journalDigest,
  fileHash,
} from "./backup-format.mjs";
const exec = promisify(execFile),
  args = process.argv.slice(2),
  command = args.shift(),
  options = {};
for (const arg of args) {
  const match = /^--([a-z-]+)=(.+)$/.exec(arg);
  if (!match || options[match[1]])
    throw Error("Use unique --name=value options");
  options[match[1]] = match[2];
}
const allowed = [
  "project",
  "key-file",
  "directory",
  "output",
  "backup",
  "journal-file",
  "master-key-file",
];
if (Object.keys(options).some((k) => !allowed.includes(k)))
  throw Error("Unknown option");
let stage, key;
async function docker(argv, stdin) {
  const child = spawn("docker", argv, {
    stdio: [stdin == null ? "ignore" : "pipe", "pipe", "pipe"],
  });
  const stderr = [];
  child.stderr.on("data", (b) => {
    if (stderr.length < 4) stderr.push(b);
  });
  const output = [];
  child.stdout.on("data", (b) => {
    if (output.reduce((n, c) => n + c.length, 0) > 16 * 1024 * 1024)
      child.kill("SIGKILL");
    else output.push(b);
  });
  const close = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) =>
      code === 0
        ? resolve(Buffer.concat(output).toString("utf8"))
        : reject(Error("Docker operation failed")),
    );
  });
  if (stdin != null) child.stdin.end(stdin);
  return close;
}
function compose(argv) {
  return [
    "compose",
    "--env-file",
    path.resolve(".townbase/compose.env"),
    "-p",
    options.project,
    ...argv,
  ];
}
async function container(service) {
  const id = (await docker(compose(["ps", "-a", "-q", service]))).trim();
  if (!/^[0-9a-f]{12,64}$/.test(id))
    throw Error("Exactly one Compose service container required");
  const info = JSON.parse(await docker(["inspect", id]))[0];
  if (
    info.Config.Labels?.["com.docker.compose.project"] !== options.project ||
    info.Config.Labels?.["com.docker.compose.service"] !== service
  )
    throw Error("Compose identity mismatch");
  return { id, info };
}
async function stoppedApi() {
  const api = await container("api");
  if (api.info.State.Running)
    throw Error("Stop this project API before backup/export/restore");
  return api;
}
async function pg() {
  const value = await container("postgres");
  if (!value.info.State.Running)
    throw Error("Start this project PostgreSQL first");
  return value;
}
async function sql(id, text) {
  return docker(
    [
      "exec",
      "-i",
      id,
      "psql",
      "-X",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "townbase",
      "-d",
      "townbase",
      "-At",
    ],
    text,
  );
}
async function streamOut(argv, filename) {
  const child = spawn("docker", argv, { stdio: ["ignore", "pipe", "ignore"] });
  const end = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) =>
      code === 0 ? resolve() : reject(Error("Database dump failed")),
    );
  });
  try {
    await Promise.all([
      pipeline(
        child.stdout,
        createWriteStream(filename, { flags: "wx", mode: 0o600 }),
      ),
      end,
    ]);
  } catch (e) {
    child.kill("SIGKILL");
    throw e;
  }
}
async function streamIn(argv, filename) {
  const child = spawn("docker", argv, { stdio: ["pipe", "ignore", "ignore"] });
  const end = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) =>
      code === 0 ? resolve() : reject(Error("Database restore failed")),
    );
  });
  try {
    await Promise.all([pipeline(createReadStream(filename), child.stdin), end]);
  } catch (e) {
    child.kill("SIGKILL");
    throw e;
  }
}
async function recordsFrom(directory) {
  const records = [];
  for (const name of await readdir(directory)) {
    if (!/^[0-9a-f-]{36}\.bin$/.test(name))
      throw Error("Invalid journal entry");
    const file = path.join(directory, name),
      s = await lstat(file);
    if (!s.isFile() || s.isSymbolicLink() || s.size > 4096)
      throw Error("Unsafe journal entry");
    const record = JSON.parse(await readFile(file, "utf8"));
    if (record.version !== 1 || !record.id || !record.createdAt)
      throw Error("Invalid deletion record");
    records.push(record);
  }
  return records.sort(
    (a, b) =>
      a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
}
async function copyJournal(api) {
  const directory = path.join(stage, "journal");
  await mkdir(directory, { mode: 0o700 });
  await docker([
    "cp",
    api.id + ":/var/lib/townbase/operations/deletions/.",
    directory,
  ]);
  return recordsFrom(directory);
}
async function marker(action, stdin) {
  return docker(
    compose([
      "run",
      "--rm",
      "-T",
      "--no-deps",
      "-e",
      "TOWNBASE_RESTORE_MAINTENANCE=1",
      "--entrypoint",
      "node",
      "api",
      "deployment/restore-agent.mjs",
      action,
    ]),
    stdin,
  );
}
try {
  if (command === "key") {
    if (!options["key-file"] || !path.isAbsolute(options["key-file"]))
      throw Error("Absolute --key-file required");
    await privateDirectory(path.dirname(options["key-file"]));
    await writeFile(
      options["key-file"],
      randomBytes(32).toString("base64url") + "\n",
      { flag: "wx", mode: 0o600 },
    );
    console.log(
      "Backup key created. Store separately from backups and model master key.",
    );
  } else {
    if (
      !["create", "restore", "journal-export"].includes(command) ||
      !options.project ||
      !/^[-a-z0-9]+$/.test(options.project)
    )
      throw Error("Use create/restore/journal-export with explicit --project");
    const root = await privateDirectory(path.resolve(".townbase"));
    stage = await mkdtemp(path.join(root, "backup-staging-"));
    await chmod(stage, 0o700);
    const api = await stoppedApi(),
      postgres = await pg();
    if (command === "journal-export") {
      if (!options.output || !path.isAbsolute(options.output))
        throw Error("Absolute --output required");
      await privateDirectory(path.dirname(options.output));
      const records = await copyJournal(api);
      await writeFile(
        options.output,
        JSON.stringify({
          version: 1,
          exportedAt: new Date().toISOString(),
          records,
        }) + "\n",
        { flag: "wx", mode: 0o600 },
      );
      console.log(
        "Deletion journal exported. Keep current and separate from the DB backup.",
      );
    } else {
      if (!options["key-file"] || !path.isAbsolute(options["key-file"]))
        throw Error("Absolute --key-file required");
      key = await readBackupKey(options["key-file"]);
      if (command === "create") {
        if (!options.directory || !path.isAbsolute(options.directory))
          throw Error("Absolute private --directory required");
        const destination = await privateDirectory(options.directory);
        const documents = path.join(stage, "documents");
        await mkdir(documents, { mode: 0o700 });
        await docker([
          "cp",
          api.id + ":/var/lib/townbase/documents/.",
          documents,
        ]);
        const records = await copyJournal(api);
        const raw = await sql(
          postgres.id,
          `SELECT json_build_object('installationId',i.id,'workspaceId',i."workspaceId",'initialized',i."initializedAt" IS NOT NULL,'migrations',(SELECT json_agg(migration_name ORDER BY migration_name) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL)) FROM "Installation" i;`,
        );
        const state = JSON.parse(raw.trim());
        if (!state.initialized)
          throw Error("Initialized installation required");
        const identityFile = path.join(
          destination,
          ".townbase-backup-directory.json",
        );
        try {
          const identity = JSON.parse(await readFile(identityFile, "utf8"));
          if (
            identity.project !== options.project ||
            identity.workspaceId !== state.workspaceId
          )
            throw Error("Backup directory belongs to another installation");
        } catch (e) {
          if (e.code !== "ENOENT") throw e;
          if ((await readdir(destination)).length !== 0)
            throw Error("Initialize a new private backup directory");
          await writeFile(
            identityFile,
            JSON.stringify({
              version: 1,
              project: options.project,
              workspaceId: state.workspaceId,
            }),
            { flag: "wx", mode: 0o600 },
          );
        }
        await streamOut(
          [
            "exec",
            postgres.id,
            "pg_dump",
            "-U",
            "townbase",
            "-d",
            "townbase",
            "--format=c",
            "--no-owner",
            "--no-privileges",
            '--exclude-table-data=public."Attachment"',
          ],
          path.join(stage, "db.dump"),
        );
        const manifest = {
          version: 1,
          createdAt: new Date().toISOString(),
          ...state,
          journalCount: records.length,
          journalRecordIds: records.map((r) => r.id),
          journalDigest: journalDigest(records),
          files: await manifestFiles(stage),
        };
        const payload = path.join(stage, "payload");
        await writeBundle(stage, payload, manifest);
        const name =
            "townbase-" +
            manifest.createdAt.replace(/[:.]/g, "-") +
            "-" +
            randomUUID() +
            ".tbk",
          output = path.join(destination, name);
        await encryptBundle(payload, output, key);
        // The primary managed copy is pruned by the API each minute and at startup.
        await streamIn(
          compose([
            "run",
            "--rm",
            "-T",
            "--no-deps",
            "--entrypoint",
            "node",
            "api",
            "deployment/restore-agent.mjs",
            "backup-import",
            name,
          ]),
          output,
        );
        await marker(
          "backup-record",
          JSON.stringify({
            createdAt: manifest.createdAt,
            name,
            sha256: await fileHash(output),
          }),
        );
        await pruneBackups(destination);
        console.log(
          JSON.stringify({
            createdAt: manifest.createdAt,
            backup: output,
            temporaryAttachmentBodiesIncluded: false,
            masterKeyIncluded: false,
            deletionJournalIncluded: false,
          }),
        );
      } else {
        if (
          !options.backup ||
          !path.isAbsolute(options.backup) ||
          !options["journal-file"] ||
          !path.isAbsolute(options["journal-file"]) ||
          !options["master-key-file"] ||
          !path.isAbsolute(options["master-key-file"])
        )
          throw Error(
            "Restore requires absolute --backup, --journal-file and separately kept --master-key-file",
          );
        const encryptedState = await lstat(options["journal-file"]);
        if (
          !encryptedState.isFile() ||
          encryptedState.isSymbolicLink() ||
          encryptedState.size > 16 * 1024 * 1024 ||
          (encryptedState.mode & 0o077) !== 0
        )
          throw Error("Unsafe journal export");
        const journal = JSON.parse(
          await readFile(options["journal-file"], "utf8"),
        );
        if (
          journal.version !== 1 ||
          !Array.isArray(journal.records) ||
          !Number.isFinite(Date.parse(journal.exportedAt))
        )
          throw Error("Invalid journal export");
        const existing = Number(
          (
            await sql(
              postgres.id,
              `SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p');`,
            )
          ).trim(),
        );
        if (existing !== 0)
          throw Error(
            "Restore target DB must be empty; never restore over live data",
          );
        const master = (
            await readFile(options["master-key-file"], "utf8")
          ).trim(),
          prepared = (
            await readFile(".townbase/secrets/model_master_key", "utf8")
          ).trim();
        if (
          !/^[A-Za-z0-9_-]{43}$/.test(master) ||
          master.length !== prepared.length ||
          !timingSafeEqual(Buffer.from(master), Buffer.from(prepared))
        )
          throw Error(
            "Prepare the separate original model master key before creating restore containers",
          );
        const payload = path.join(stage, "payload");
        await decryptBundle(options.backup, payload, key);
        const unpack = path.join(stage, "restore");
        const manifest = await unpackBundle(payload, unpack);
        if (
          Date.parse(journal.exportedAt) < Date.parse(manifest.createdAt) ||
          journal.records.length < manifest.journalCount ||
          !Array.isArray(manifest.journalRecordIds) ||
          journalDigest(
            journal.records.filter((r) =>
              manifest.journalRecordIds.includes(r.id),
            ),
          ) !== manifest.journalDigest
        )
          throw Error(
            "Deletion journal is older than or incompatible with backup",
          );
        const supported = await readdir(
          path.resolve("packages/database/prisma/migrations"),
        );
        if (
          !Array.isArray(manifest.migrations) ||
          manifest.migrations.some((m) => !supported.includes(m))
        )
          throw Error("Backup requires newer/unknown migrations");
        const existingDocs = path.join(stage, "existing-documents");
        await mkdir(existingDocs, { mode: 0o700 });
        await docker([
          "cp",
          api.id + ":/var/lib/townbase/documents/.",
          existingDocs,
        ]);
        const entries = async (dir) => {
          for (const item of await readdir(dir, { withFileTypes: true })) {
            if (!item.isDirectory()) return true;
            if (await entries(path.join(dir, item.name))) return true;
          }
          return false;
        };
        if (await entries(existingDocs))
          throw Error("Restore target document volume must be empty");
        await marker("prepare");
        await streamIn(
          [
            "exec",
            "-i",
            postgres.id,
            "pg_restore",
            "-U",
            "townbase",
            "-d",
            "townbase",
            "--no-owner",
            "--no-privileges",
            "--exit-on-error",
          ],
          path.join(unpack, "db.dump"),
        );
        await docker(compose(["run", "--rm", "-T", "--no-deps", "migration"]));
        await marker("prepare-documents");
        for (const file of manifest.files.filter((f) =>
          f.name.startsWith("documents/"),
        )) {
          const source = path.join(unpack, file.name);
          await streamIn(
            compose([
              "run",
              "--rm",
              "-T",
              "--no-deps",
              "-e",
              "TOWNBASE_RESTORE_MAINTENANCE=1",
              "--entrypoint",
              "node",
              "api",
              "deployment/restore-agent.mjs",
              "document",
              file.name.slice("documents/".length),
            ]),
            source,
          );
        }
        await sql(
          postgres.id,
          `UPDATE "AdministratorSession" SET "revokedAt"=CURRENT_TIMESTAMP; UPDATE "AuthenticationState" SET "recoveryHash"=NULL,"recoveryExpiresAt"=NULL,"recoveryConsumedAt"=NULL; UPDATE "ModelExecutionSettings" SET "priceVersion"=NULL;`,
        );
        await marker(
          "verify",
          JSON.stringify({
            version: 1,
            records: journal.records,
            restoredAt: new Date().toISOString(),
            backupAt: manifest.createdAt,
          }),
        );
        console.log(
          JSON.stringify({
            restored: true,
            backupAt: manifest.createdAt,
            apiStillStopped: true,
            costReconciliationRequired: true,
          }),
        );
      }
    }
  }
} catch {
  console.error(
    "TOWNBASE_BACKUP_OPERATION_FAILED: check explicit project, stopped API, private paths/key, empty restore target and current deletion journal. A failed restore remains offline.",
  );
  process.exitCode = 1;
} finally {
  key?.fill(0);
  if (stage) await rm(stage, { recursive: true, force: true });
}
