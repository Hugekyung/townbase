import {
  chmod,
  lstat,
  mkdir,
  open,
  rename,
  unlink,
  realpath,
  readdir,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

const TEMP_PREFIX = ".townbase-bootstrap-";
const TEMP_SUFFIX = ".tmp";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LEGACY_TEMP =
  /^\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.tmp$/;
export function temporaryTokenName(): string {
  return `${TEMP_PREFIX}${randomUUID()}${TEMP_SUFFIX}`;
}
function isTemporaryTokenName(name: string): boolean {
  return (
    LEGACY_TEMP.test(name) ||
    (name.startsWith(TEMP_PREFIX) &&
      name.endsWith(TEMP_SUFFIX) &&
      UUID.test(name.slice(TEMP_PREFIX.length, -TEMP_SUFFIX.length)))
  );
}
async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export type TokenPurpose = "bootstrap" | "recovery";
export function tokenDirectory(purpose: TokenPurpose = "bootstrap"): string {
  const key =
    purpose === "bootstrap"
      ? "TOWNBASE_BOOTSTRAP_PATH"
      : "TOWNBASE_RECOVERY_PATH";
  const value = process.env[key];
  if (!value || !path.isAbsolute(value))
    throw new Error("Bootstrap storage is not configured");
  for (const storage of [
    process.env.TOWNBASE_DOCUMENTS_PATH,
    process.env.TOWNBASE_ATTACHMENTS_PATH,
    purpose === "bootstrap"
      ? process.env.TOWNBASE_RECOVERY_PATH
      : process.env.TOWNBASE_BOOTSTRAP_PATH,
  ]) {
    if (storage) {
      const a = path.resolve(value),
        b = path.resolve(storage);
      if (
        a === b ||
        a.startsWith(`${b}${path.sep}`) ||
        b.startsWith(`${a}${path.sep}`)
      )
        throw new Error("Bootstrap storage must be separate");
    }
  }
  return value;
}

export async function prepareTokenDirectory(
  purpose: TokenPurpose = "bootstrap",
): Promise<string> {
  const directory = tokenDirectory(purpose);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error("Unsafe bootstrap storage");
  await chmod(directory, 0o700);
  const resolved = await realpath(directory);
  for (const storage of [
    process.env.TOWNBASE_DOCUMENTS_PATH,
    process.env.TOWNBASE_ATTACHMENTS_PATH,
    purpose === "bootstrap"
      ? process.env.TOWNBASE_RECOVERY_PATH
      : process.env.TOWNBASE_BOOTSTRAP_PATH,
  ]) {
    if (!storage) continue;
    const other = await realpath(storage);
    if (
      resolved === other ||
      resolved.startsWith(`${other}${path.sep}`) ||
      other.startsWith(`${resolved}${path.sep}`)
    )
      throw new Error("Bootstrap storage must be separate");
  }
  return directory;
}

export async function writeTokenFile(
  token: string,
  purpose: TokenPurpose = "bootstrap",
): Promise<void> {
  const directory = await prepareTokenDirectory(purpose);
  const filename = path.join(directory, temporaryTokenName());
  try {
    const file = await open(filename, "wx", 0o600);
    try {
      await file.writeFile(`${token}\n`);
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(filename, path.join(directory, "token"));
    await syncDirectory(directory);
  } finally {
    await unlink(filename).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}

export async function deleteTokenFile(
  purpose: TokenPurpose = "bootstrap",
): Promise<void> {
  await unlink(path.join(tokenDirectory(purpose), "token")).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    },
  );
}

// Call under the matching BootstrapState/AuthenticationState issuance lock.
// An interrupted atomic write must not leave plaintext temporary credentials.
export async function deleteTemporaryTokenFiles(
  purpose: TokenPurpose = "bootstrap",
): Promise<void> {
  const directory = tokenDirectory(purpose);
  for (const name of await readdir(directory)) {
    if (isTemporaryTokenName(name)) await unlink(path.join(directory, name));
  }
}
