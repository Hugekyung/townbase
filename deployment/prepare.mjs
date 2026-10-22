import { randomBytes } from "node:crypto";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

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
const filename = path.join(secrets, "postgres_password");
try {
  // 0700 parent protects the host file; selected containers mount it read-only.
  writeFileSync(filename, `${randomBytes(32).toString("base64url")}\n`, {
    flag: "wx",
    mode: 0o444,
  });
} catch (error) {
  if (error.code !== "EEXIST") throw error;
  const stat = lstatSync(filename);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    readFileSync(filename, "utf8").trim().length < 32
  ) {
    throw new Error("Existing database secret is invalid; it was not replaced");
  }
}
console.log("Deployment secret is ready. Existing values were preserved.");
