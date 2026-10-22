import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  lstatSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { databaseEnvironment } from "../database-env.mjs";

test("missing/short secrets are rejected, and special characters are encoded", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "townbase-secret-"));
  try {
    assert.throws(() => databaseEnvironment({}));
    const secret = path.join(dir, "password");
    writeFileSync(secret, "short");
    assert.throws(() =>
      databaseEnvironment({ POSTGRES_PASSWORD_FILE: secret }),
    );
    const password = "test:@/?#&+".repeat(4);
    writeFileSync(secret, password);
    const url = new URL(
      databaseEnvironment({ POSTGRES_PASSWORD_FILE: secret }),
    );
    assert.equal(decodeURIComponent(url.password), password);
    assert.equal(url.hostname, "postgres");
    assert.equal(url.searchParams.get("schema"), "public");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("prepare preserves an existing secret and protects its parent directory", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "townbase-prepare-"));
  const prepare = fileURLToPath(new URL("../prepare.mjs", import.meta.url));
  try {
    execFileSync(process.execPath, [prepare], { cwd: dir });
    const filename = path.join(dir, ".townbase/secrets/postgres_password");
    const before = readFileSync(filename, "utf8");
    assert.equal(Buffer.from(before.trim(), "base64url").length, 32);
    execFileSync(process.execPath, [prepare], { cwd: dir });
    assert.equal(readFileSync(filename, "utf8"), before);
    assert.equal(lstatSync(path.dirname(filename)).mode & 0o777, 0o700);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
