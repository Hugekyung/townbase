import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  lstatSync,
  chmodSync,
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
    execFileSync(
      process.execPath,
      ["-e", "process.umask(0o077); require(process.argv[1])", prepare],
      { cwd: dir },
    );
    const files = [
      "postgres_password",
      "runtime_password",
      "model_master_key",
    ].map((name) => path.join(dir, ".townbase/secrets", name));
    const values = files.map((filename) => readFileSync(filename, "utf8"));
    assert.equal(new Set(values).size, 3);
    for (const [index, filename] of files.entries()) {
      assert.equal(Buffer.from(values[index].trim(), "base64url").length, 32);
      assert.equal(lstatSync(filename).mode & 0o777, 0o444);
      chmodSync(filename, 0o666);
    }
    execFileSync(process.execPath, [prepare], { cwd: dir });
    for (const [index, filename] of files.entries()) {
      assert.equal(readFileSync(filename, "utf8"), values[index]);
      assert.equal(lstatSync(filename).mode & 0o777, 0o444);
      assert.equal(lstatSync(path.dirname(filename)).mode & 0o777, 0o700);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

for (const name of [
  "postgres_password",
  "runtime_password",
  "model_master_key",
]) {
  test(`prepare identifies invalid ${name} without replacing it or disclosing its value`, () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "townbase-invalid-secret-"));
    const prepare = fileURLToPath(new URL("../prepare.mjs", import.meta.url));
    try {
      execFileSync(process.execPath, [prepare], { cwd: dir });
      const filename = path.join(dir, ".townbase/secrets", name);
      chmodSync(filename, 0o600);
      writeFileSync(filename, "short-secret-canary");
      assert.throws(
        () =>
          execFileSync(process.execPath, [prepare], {
            cwd: dir,
            stdio: "pipe",
          }),
        (error) => {
          const output = Buffer.concat([error.stdout, error.stderr]).toString();
          assert.ok(output.includes(`Existing ${name} secret is invalid`));
          assert.ok(!output.includes("short-secret-canary"));
          return true;
        },
      );
      assert.equal(readFileSync(filename, "utf8"), "short-secret-canary");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
