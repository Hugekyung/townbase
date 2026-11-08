import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  open,
  stat,
  lstat,
  mkdir,
  realpath,
  chmod,
  unlink,
  readdir,
} from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { once } from "node:events";
import path from "node:path";
const MAGIC = Buffer.from("TOWNBASE-BACKUP-1\n"),
  PAYLOAD = Buffer.from("TOWNBASE-FILES-1\n");
export async function privateDirectory(root) {
  if (!path.isAbsolute(root))
    throw Error("Absolute private directory required");
  await mkdir(root, { recursive: true, mode: 0o700 });
  const s = await lstat(root);
  if (
    !s.isDirectory() ||
    s.isSymbolicLink() ||
    (s.mode & 0o077) !== 0 ||
    (await realpath(root)) !== root
  )
    throw Error("Unsafe private directory");
  return root;
}
export async function readBackupKey(filename) {
  const handle = await open(filename, "r");
  try {
    const s = await handle.stat();
    const link = await lstat(filename);
    if (
      !s.isFile() ||
      link.isSymbolicLink() ||
      s.size > 128 ||
      (s.mode & 0o077) !== 0
    )
      throw Error("Unsafe backup key");
    const text = (await handle.readFile("utf8")).trim();
    if (!/^[A-Za-z0-9_-]{43}$/.test(text)) throw Error("Invalid backup key");
    const key = Buffer.from(text, "base64url");
    if (key.length !== 32 || key.toString("base64url") !== text)
      throw Error("Invalid backup key");
    return key;
  } finally {
    await handle.close();
  }
}
export async function fileHash(filename) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest("hex");
}
export function allowedName(name) {
  return (
    name === "db.dump" ||
    /^documents\/(originals|pending)\/[0-9a-f-]{36}\.bin$/.test(name)
  );
}
export async function manifestFiles(stage) {
  const result = [];
  const scan = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const filename = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) throw Error("Symlink in backup input");
      if (entry.isDirectory()) await scan(filename);
      else {
        const name = path.relative(stage, filename).split(path.sep).join("/");
        if (!allowedName(name)) throw Error("Unexpected backup input");
        const s = await lstat(filename);
        if (!s.isFile() || s.nlink !== 1) throw Error("Unsafe backup input");
        result.push({ name, size: s.size, sha256: await fileHash(filename) });
      }
    }
  };
  await scan(path.join(stage, "documents"));
  const dump = path.join(stage, "db.dump");
  const s = await lstat(dump);
  if (!s.isFile() || s.isSymbolicLink()) throw Error("Invalid database dump");
  result.unshift({
    name: "db.dump",
    size: s.size,
    sha256: await fileHash(dump),
  });
  return result.sort((a, b) => a.name.localeCompare(b.name));
}
export async function writeBundle(stage, filename, manifest) {
  const encoded = Buffer.from(JSON.stringify(manifest));
  if (encoded.length > 8 * 1024 * 1024) throw Error("Manifest too large");
  const out = createWriteStream(filename, { flags: "wx", mode: 0o600 });
  let failure;
  out.on("error", (e) => {
    failure = e;
  });
  const write = async (bytes) => {
    if (failure) throw failure;
    if (!out.write(bytes)) await once(out, "drain");
  };
  try {
    await write(PAYLOAD);
    const size = Buffer.alloc(4);
    size.writeUInt32BE(encoded.length);
    await write(size);
    await write(encoded);
    for (const file of manifest.files)
      for await (const bytes of createReadStream(path.join(stage, file.name)))
        await write(bytes);
    out.end();
    await once(out, "close");
    if (failure) throw failure;
  } catch (e) {
    out.destroy();
    await unlink(filename).catch(() => {});
    throw e;
  }
}
export async function encryptBundle(input, output, key) {
  const nonce = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(MAGIC);
  const header = await open(output, "wx", 0o600);
  try {
    await header.write(Buffer.concat([MAGIC, nonce]));
  } finally {
    await header.close();
  }
  try {
    await pipeline(
      createReadStream(input),
      cipher,
      createWriteStream(output, { flags: "r+", start: MAGIC.length + 12 }),
    );
    const tail = await open(output, "a");
    try {
      await tail.write(cipher.getAuthTag());
      await tail.sync();
    } finally {
      await tail.close();
    }
  } catch (e) {
    await unlink(output).catch(() => {});
    throw e;
  }
}
export async function decryptBundle(input, output, key) {
  const s = await lstat(input);
  if (!s.isFile() || s.isSymbolicLink() || s.size < MAGIC.length + 28)
    throw Error("Invalid backup file");
  const handle = await open(input, "r");
  try {
    const header = Buffer.alloc(MAGIC.length + 12),
      tag = Buffer.alloc(16);
    await handle.read(header, 0, header.length, 0);
    await handle.read(tag, 0, 16, s.size - 16);
    if (!header.subarray(0, MAGIC.length).equals(MAGIC))
      throw Error("Unsupported backup");
    const cipher = createDecipheriv(
      "aes-256-gcm",
      key,
      header.subarray(MAGIC.length),
    );
    cipher.setAAD(MAGIC);
    cipher.setAuthTag(tag);
    try {
      await pipeline(
        createReadStream(input, { start: header.length, end: s.size - 17 }),
        cipher,
        createWriteStream(output, { flags: "wx", mode: 0o600 }),
      );
    } catch (e) {
      await unlink(output).catch(() => {});
      throw e;
    }
  } finally {
    await handle.close();
  }
}
export async function unpackBundle(input, stage) {
  await privateDirectory(stage);
  const h = await open(input, "r");
  let position = 0;
  const read = async (size) => {
    const buffer = Buffer.alloc(size);
    let got = 0;
    while (got < size) {
      const r = await h.read(buffer, got, size - got, position + got);
      if (!r.bytesRead) throw Error("Truncated backup");
      got += r.bytesRead;
    }
    position += size;
    return buffer;
  };
  try {
    if (!(await read(PAYLOAD.length)).equals(PAYLOAD))
      throw Error("Invalid payload");
    const length = (await read(4)).readUInt32BE();
    if (length < 1 || length > 8 * 1024 * 1024)
      throw Error("Invalid manifest size");
    const m = JSON.parse((await read(length)).toString("utf8"));
    if (
      m.version !== 1 ||
      !Array.isArray(m.files) ||
      m.files.length < 1 ||
      m.files.length > 20000 ||
      !m.files.some((f) => f.name === "db.dump") ||
      new Set(m.files.map((f) => f.name)).size !== m.files.length
    )
      throw Error("Invalid manifest");
    for (const f of m.files) {
      if (
        !allowedName(f.name) ||
        !Number.isSafeInteger(f.size) ||
        f.size < 0 ||
        f.size > 40 * 1024 ** 3 ||
        !/^[0-9a-f]{64}$/.test(f.sha256)
      )
        throw Error("Unsafe manifest entry");
      const filename = path.join(stage, f.name);
      await mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
      if ((await realpath(path.dirname(filename))) !== path.dirname(filename))
        throw Error("Unsafe restore parent");
      const out = await open(filename, "wx", 0o600);
      const hash = createHash("sha256");
      try {
        let remaining = f.size;
        while (remaining > 0) {
          const bytes = await read(Math.min(remaining, 65536));
          hash.update(bytes);
          await out.writeFile(bytes);
          remaining -= bytes.length;
        }
        await out.sync();
      } finally {
        await out.close();
      }
      if (hash.digest("hex") !== f.sha256)
        throw Error("Backup checksum mismatch");
    }
    if (position !== (await h.stat()).size)
      throw Error("Unexpected trailing backup data");
    return m;
  } finally {
    await h.close();
  }
}
export const BACKUP_NAME =
  /^townbase-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)-[0-9a-f-]{36}\.tbk$/;
export function backupTime(name) {
  const m = BACKUP_NAME.exec(name);
  if (!m) return null;
  const iso = m[1].replace(
    /T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/,
    "T$1:$2:$3.$4Z",
  );
  const n = Date.parse(iso);
  return Number.isFinite(n) ? n : null;
}
export async function pruneBackups(root, now = Date.now()) {
  await privateDirectory(root);
  const files = [];
  for (const name of await readdir(root)) {
    const time = backupTime(name);
    if (time == null) continue;
    const s = await lstat(path.join(root, name));
    if (!s.isFile() || s.isSymbolicLink()) throw Error("Unsafe backup entry");
    files.push({ name, time });
  }
  files.sort((a, b) => b.time - a.time || b.name.localeCompare(a.name));
  let removed = 0;
  for (const [i, f] of files.entries())
    if (i >= 7 || f.time + 7 * 86400000 <= now) {
      await unlink(path.join(root, f.name));
      removed++;
    }
  return removed;
}
export function journalDigest(records) {
  const ordered = [...records].sort(
    (a, b) =>
      a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
  return createHash("sha256").update(JSON.stringify(ordered)).digest("hex");
}
