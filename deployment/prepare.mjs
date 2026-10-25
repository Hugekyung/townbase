import { randomBytes } from "node:crypto";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

function validExistingSecret(name, stat, filename) {
  if (!stat.isFile() || stat.isSymbolicLink()) return false;
  if (name === "model_master_key" && stat.size > 128) return false;
  const value = readFileSync(filename, "utf8").trim();
  if (name !== "model_master_key") return value.length >= 32;
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) return false;
  const decoded = Buffer.from(value, "base64url");
  try {
    return decoded.length === 32 && decoded.toString("base64url") === value;
  } finally {
    decoded.fill(0);
  }
}

const root = path.resolve(".townbase");
const secrets = path.join(root, "secrets");
for (const directory of [root, secrets]) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (
    !lstatSync(directory).isDirectory() ||
    lstatSync(directory).isSymbolicLink()
  ) {
    throw new Error("Secret directory must not be a symlink");
  }
  chmodSync(directory, 0o700);
}
for (const name of [
  "postgres_password",
  "runtime_password",
  "model_master_key",
]) {
  const filename = path.join(secrets, name);
  try {
    // 0700 parent protects the host file; selected containers mount it read-only.
    writeFileSync(filename, `${randomBytes(32).toString("base64url")}\n`, {
      flag: "wx",
      mode: 0o444,
    });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const stat = lstatSync(filename);
    if (!validExistingSecret(name, stat, filename)) {
      throw new Error(
        `Existing ${name} secret is invalid; it was not replaced`,
      );
    }
  }
  // Also normalize creation under a restrictive host umask: node containers
  // need read access, while the 0700 host parent remains the access boundary.
  chmodSync(filename, 0o444);
}
console.log("Deployment secret is ready. Existing values were preserved.");
