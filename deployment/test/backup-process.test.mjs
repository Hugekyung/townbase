import test from "node:test";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import {
  mkdtemp,
  writeFile,
  chmod,
  rm,
  realpath,
  access,
  mkdir,
  readFile,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { docker } from "../backup-process.mjs";
test("early child exit handles stdin EPIPE and runs plaintext cleanup", async () => {
  const root = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "townbase-epipe-")),
  );
  const original = process.env.PATH;
  try {
    await writeFile(path.join(root, "docker"), "#!/bin/sh\nexit 1\n");
    await chmod(path.join(root, "docker"), 0o700);
    process.env.PATH = root;
    const stage = path.join(root, "plaintext");
    await writeFile(stage, "SYNTHETIC_SECRET");
    let failed = false;
    try {
      await docker(["synthetic-test"], Buffer.alloc(8 * 1024 * 1024));
    } catch {
      failed = true;
    } finally {
      await rm(stage, { force: true });
    }
    assert.equal(failed, true);
    await assert.rejects(access(stage));
  } finally {
    process.env.PATH = original;
    await rm(root, { recursive: true, force: true });
  }
});

test("backup-import collision leaves the existing managed backup unchanged", async () => {
  const root = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "townbase-import-")),
  );
  try {
    const dir = path.join(root, "backups");
    await mkdir(dir, { mode: 0o700 });
    const name = "townbase-2026-11-08T00-00-00-000Z-" + randomUUID() + ".tbk";
    await writeFile(path.join(dir, name), "EXISTING_SYNTHETIC_BACKUP", {
      mode: 0o600,
    });
    const result = spawnSync(
      process.execPath,
      ["deployment/restore-agent.mjs", "backup-import", name],
      {
        cwd: process.cwd(),
        env: { ...process.env, TOWNBASE_OPERATIONS_PATH: root },
        input: "NEW_SYNTHETIC_BACKUP",
        encoding: "utf8",
      },
    );
    assert.equal(result.status, 1);
    assert.equal(
      await readFile(path.join(dir, name), "utf8"),
      "EXISTING_SYNTHETIC_BACKUP",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
