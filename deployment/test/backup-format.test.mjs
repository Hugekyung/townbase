import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  readdir,
  chmod,
  realpath,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import {
  manifestFiles,
  writeBundle,
  encryptBundle,
  decryptBundle,
  unpackBundle,
  pruneBackups,
  backupTime,
  validateManifest,
  validateDeletionExport,
  BACKUP_LIMITS,
} from "../backup-format.mjs";
test("encrypted backup round-trip restores exact files and excludes attachment bodies", async () => {
  const root = await realpath(
    await mkdtemp(path.join(tmpdir(), "townbase-backup-")),
  );
  await chmod(root, 0o700);
  const key = randomBytes(32);
  try {
    const stage = path.join(root, "stage");
    await mkdir(path.join(stage, "documents", "originals"), {
      recursive: true,
      mode: 0o700,
    });
    const file = randomUUID() + ".bin";
    await writeFile(path.join(stage, "db.dump"), "SYNTHETIC DB");
    await writeFile(
      path.join(stage, "documents", "originals", file),
      "SYNTHETIC DOCUMENT",
    );
    const forbidden = path.join(stage, "documents", "attachments");
    await mkdir(forbidden);
    await writeFile(path.join(forbidden, "private.bin"), "PRIVATE_BODY");
    await assert.rejects(manifestFiles(stage), /Unexpected backup input/);
    await rm(forbidden, { recursive: true });
    const manifest = {
      version: 1,
      createdAt: new Date().toISOString(),
      files: await manifestFiles(stage),
    };
    const payload = path.join(root, "payload"),
      encrypted = path.join(root, "backup"),
      decrypted = path.join(root, "decrypted");
    await writeBundle(stage, payload, manifest);
    await encryptBundle(payload, encrypted, key);
    assert.equal(
      (await readFile(encrypted)).includes(Buffer.from("SYNTHETIC")),
      false,
    );
    await decryptBundle(encrypted, decrypted, key);
    const restored = path.join(root, "restored");
    assert.deepEqual(await unpackBundle(decrypted, restored), manifest);
    assert.equal(
      await readFile(
        path.join(restored, "documents", "originals", file),
        "utf8",
      ),
      "SYNTHETIC DOCUMENT",
    );
    assert.deepEqual(await readdir(restored), ["db.dump", "documents"]);
  } finally {
    key.fill(0);
    await rm(root, { recursive: true, force: true });
  }
});
test("wrong key and tampered ciphertext fail authentication and remove plaintext output", async () => {
  const root = await realpath(
    await mkdtemp(path.join(tmpdir(), "townbase-backup-")),
  );
  await chmod(root, 0o700);
  try {
    const input = path.join(root, "input"),
      encrypted = path.join(root, "cipher");
    await writeFile(input, "SYNTHETIC");
    const key = randomBytes(32);
    await encryptBundle(input, encrypted, key);
    await assert.rejects(
      decryptBundle(encrypted, path.join(root, "wrong"), randomBytes(32)),
    );
    assert.equal((await readdir(root)).includes("wrong"), false);
    const bytes = await readFile(encrypted);
    bytes[bytes.length - 17] ^= 1;
    await writeFile(encrypted, bytes);
    await assert.rejects(
      decryptBundle(encrypted, path.join(root, "tampered"), key),
    );
    assert.equal((await readdir(root)).includes("tampered"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("retention keeps only seven managed backups and removes seven-day-old files", async () => {
  const root = await realpath(
    await mkdtemp(path.join(tmpdir(), "townbase-backup-")),
  );
  await chmod(root, 0o700);
  const now = Date.now();
  try {
    for (let i = 0; i < 10; i++) {
      const iso = new Date(now - i * 86400000)
        .toISOString()
        .replace(/[:.]/g, "-");
      const name = "townbase-" + iso + "-" + randomUUID() + ".tbk";
      assert.equal(
        backupTime(name),
        Date.parse(new Date(now - i * 86400000).toISOString()),
      );
      await writeFile(path.join(root, name), "synthetic");
    }
    await writeFile(path.join(root, "unrelated.txt"), "keep");
    assert.equal(await pruneBackups(root, now), 3);
    assert.equal((await readdir(root)).length, 8);
    assert.equal(
      await readFile(path.join(root, "unrelated.txt"), "utf8"),
      "keep",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("restore rejects unsafe, duplicate and truncated manifests without overwriting existing files", async () => {
  const root = await realpath(
    await mkdtemp(path.join(tmpdir(), "townbase-manifest-")),
  );
  await chmod(root, 0o700);
  try {
    const make = async (name, manifest, body = Buffer.alloc(0)) => {
      const json = Buffer.from(JSON.stringify(manifest)),
        length = Buffer.alloc(4);
      length.writeUInt32BE(json.length);
      const file = path.join(root, name);
      await writeFile(
        file,
        Buffer.concat([Buffer.from("TOWNBASE-FILES-1\n"), length, json, body]),
      );
      return file;
    };
    const base = { name: "db.dump", size: 1, sha256: "a".repeat(64) };
    for (const [i, files] of [
      [base, { ...base, name: "../escape" }],
      [base, base],
      [{ ...base, size: -1 }],
      [{ ...base, name: "attachments/raw.bin" }],
    ].entries()) {
      const input = await make("bad" + i, { version: 1, files });
      await assert.rejects(unpackBundle(input, path.join(root, "stage" + i)));
    }
    const input = await make("truncated", { version: 1, files: [base] });
    await assert.rejects(
      unpackBundle(input, path.join(root, "truncated-stage")),
    );
    const stage = path.join(root, "existing");
    await mkdir(stage, { mode: 0o700 });
    await writeFile(path.join(stage, "db.dump"), "keep");
    await assert.rejects(unpackBundle(input, stage));
    assert.equal(await readFile(path.join(stage, "db.dump"), "utf8"), "keep");
    assert.equal((await readdir(root)).includes("escape"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("creation and restore share size and count limits before touching the destination", async () => {
  const entry = { name: "db.dump", size: 1, sha256: "a".repeat(64) };
  assert.doesNotThrow(() =>
    validateManifest({
      version: 1,
      files: [{ ...entry, size: BACKUP_LIMITS.fileBytes }],
    }),
  );
  assert.throws(() =>
    validateManifest({
      version: 1,
      files: [{ ...entry, size: BACKUP_LIMITS.fileBytes + 1 }],
    }),
  );
  const tooMany = {
    version: 1,
    files: Array.from({ length: BACKUP_LIMITS.entries + 1 }, (_, i) =>
      i === 0
        ? entry
        : { ...entry, name: `documents/originals/${randomUUID()}.bin` },
    ),
  };
  assert.throws(() => validateManifest(tooMany));
  const root = await mkdtemp(path.join(tmpdir(), "townbase-limit-"));
  try {
    const target = path.join(root, "existing");
    await writeFile(target, "KEEP");
    await assert.rejects(
      writeBundle(root, target, { version: 1, files: [entry] }),
    );
    assert.equal(await readFile(target, "utf8"), "KEEP");
    await assert.rejects(writeBundle(root, path.join(root, "new"), tooMany));
    assert.deepEqual(await readdir(root), ["existing"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("retention independently enforces seven recent copies", async () => {
  const root = await realpath(
      await mkdtemp(path.join(tmpdir(), "townbase-count-")),
    ),
    now = Date.now();
  try {
    for (let i = 0; i < 9; i++)
      await writeFile(
        path.join(
          root,
          "townbase-" +
            new Date(now - i * 1000).toISOString().replace(/[:.]/g, "-") +
            "-" +
            randomUUID() +
            ".tbk",
        ),
        "SYNTHETIC",
      );
    assert.equal(await pruneBackups(root, now), 2);
    assert.equal((await readdir(root)).length, 7);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("journal export validates additional records before restore preparation", () => {
  const record = {
    version: 1,
    id: randomUUID(),
    targetId: randomUUID(),
    kind: "file",
    installationId: "primary",
    workspaceId: "synthetic",
    ownerAdministratorId: "owner",
    scopeRevision: null,
    createdAt: new Date().toISOString(),
  };
  const journal = {
    version: 1,
    exportedAt: record.createdAt,
    records: [record],
  };
  assert.doesNotThrow(() => validateDeletionExport(journal));
  for (const extra of [
    { ...record, id: randomUUID(), kind: "arbitrary" },
    { ...record, id: randomUUID(), scopeRevision: 2 },
    { ...record, id: randomUUID(), extra: "body" },
    { ...record, targetId: "../outside" },
    { ...record, id: randomUUID(), createdAt: "invalid" },
  ])
    assert.throws(() =>
      validateDeletionExport({ ...journal, records: [record, extra] }),
    );
});
