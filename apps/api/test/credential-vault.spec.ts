import crypto from "node:crypto";
import { mkdtemp, writeFile, chmod, symlink, rm } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import os from "node:os";
import {
  CredentialVault,
  validApiKey,
} from "../src/model-integration/credential-vault";
describe("installation-bound credential encryption", () => {
  const vault = new CredentialVault(),
    original = process.env.TOWNBASE_MASTER_KEY_FILE;
  const key = "sk-synthetic-secret-canary-1234567890";
  let directory: string, master: string;
  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "townbase-vault-"));
    master = path.join(directory, "master");
    await writeFile(master, randomBytes(32).toString("base64url") + "\n", {
      mode: 0o444,
    });
    process.env.TOWNBASE_MASTER_KEY_FILE = master;
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    if (original == null) delete process.env.TOWNBASE_MASTER_KEY_FILE;
    else process.env.TOWNBASE_MASTER_KEY_FILE = original;
    await rm(directory, { recursive: true, force: true });
  });
  it("roundtrips with distinct nonces and no plaintext in the envelope", async () => {
    const a = await vault.seal("primary", "embedding", key),
      b = await vault.seal("primary", "embedding", key);
    expect(a.nonce).not.toBe(b.nonce);
    expect(JSON.stringify(a)).not.toContain(key);
    expect(await vault.reveal("primary", "embedding", a)).toBe(key);
    expect(await vault.reveal("primary", "embedding", b)).toBe(key);
  });
  it("roundtrips both permitted API key length boundaries", async () => {
    for (const length of [16, 512]) {
      const key = "a".repeat(length);
      const sealed = await vault.seal("primary", "answer", key);
      expect(await vault.reveal("primary", "answer", sealed)).toBe(key);
    }
  });
  it("authenticates the installation, purpose, format, nonce, ciphertext and tag", async () => {
    const value = await vault.seal("primary", "answer", key);
    await expect(vault.reveal("foreign", "answer", value)).rejects.toThrow();
    await expect(vault.reveal("primary", "embedding", value)).rejects.toThrow();
    for (const field of ["nonce", "ciphertext", "tag", "keyId"] as const) {
      const corrupted = { ...value, [field]: "!" + value[field].slice(1) };
      await expect(
        vault.reveal("primary", "answer", corrupted),
      ).rejects.toThrow();
    }
    await expect(
      vault.reveal("primary", "answer", { ...value, formatVersion: 2 }),
    ).rejects.toThrow();
  });
  it.each(["nonce", "ciphertext", "tag"] as const)(
    "rejects canonically encoded %s tampering at authentication",
    async (field) => {
      const sealed = await vault.seal("primary", "answer", key);
      const bytes = Buffer.from(sealed[field], "base64url");
      bytes[0] = bytes[0]! ^ 1;
      const encoded = bytes.toString("base64url");
      expect(encoded.length).toBe(sealed[field].length);
      await expect(
        vault.reveal("primary", "answer", { ...sealed, [field]: encoded }),
      ).rejects.toThrow("credential_unavailable");
    },
  );
  it.each([false, true])(
    "wipes owned plaintext buffers even when authentication fails: %p",
    async (corrupt) => {
      const sealed = { ...(await vault.seal("primary", "answer", key)) };
      if (corrupt) {
        const tag = Buffer.from(sealed.tag, "base64url");
        tag[0] = tag[0]! ^ 1;
        sealed.tag = tag.toString("base64url");
      }
      const captured: Buffer[] = [],
        create = crypto.createDecipheriv,
        concat = Buffer.concat;
      const factory = (...args: unknown[]) => {
        const decipher = Reflect.apply(create, crypto, args) as ReturnType<
          typeof crypto.createDecipheriv
        >;
        const update = decipher.update.bind(decipher);
        decipher.update = ((...parameters: unknown[]) => {
          const value = Reflect.apply(update, decipher, parameters) as Buffer;
          captured.push(value);
          return value;
        }) as typeof decipher.update;
        return decipher;
      };
      jest
        .spyOn(crypto, "createDecipheriv")
        .mockImplementation(factory as typeof crypto.createDecipheriv);
      jest.spyOn(Buffer, "concat").mockImplementation((list, length) => {
        const value = concat(list, length);
        if (list.some((buffer) => captured.includes(buffer as Buffer)))
          captured.push(value);
        return value;
      });
      if (corrupt)
        await expect(vault.reveal("primary", "answer", sealed)).rejects.toThrow(
          "credential_unavailable",
        );
      else expect(await vault.reveal("primary", "answer", sealed)).toBe(key);
      expect(captured.length).toBeGreaterThan(0);
      expect(captured.some((buffer) => buffer.length > 0)).toBe(true);
      expect(
        captured.every((buffer) => buffer.every((byte) => byte === 0)),
      ).toBe(true);
    },
  );
  it("fails closed for missing, malformed, writable, symlinked and replaced master keys", async () => {
    const value = await vault.seal("primary", "answer", key);
    delete process.env.TOWNBASE_MASTER_KEY_FILE;
    await expect(vault.seal("primary", "answer", key)).rejects.toThrow();
    process.env.TOWNBASE_MASTER_KEY_FILE = path.join(directory, "missing");
    await expect(vault.reveal("primary", "answer", value)).rejects.toThrow();
    const alias = path.join(directory, "alias");
    await symlink(master, alias);
    process.env.TOWNBASE_MASTER_KEY_FILE = alias;
    await expect(vault.reveal("primary", "answer", value)).rejects.toThrow();
    process.env.TOWNBASE_MASTER_KEY_FILE = master;
    await chmod(master, 0o600);
    await expect(vault.seal("primary", "answer", key)).rejects.toThrow();
    for (const text of [
      "invalid",
      randomBytes(32).toString("base64url"),
      "x".repeat(200),
    ]) {
      await writeFile(master, text);
      await chmod(master, 0o444);
      await expect(vault.reveal("primary", "answer", value)).rejects.toThrow();
      await chmod(master, 0o600);
    }
  });
  it.each([
    undefined,
    null,
    "",
    "short",
    "x".repeat(513),
    "has whitespace in a key",
    "secret-canary\n",
    "é".repeat(20),
  ])("rejects malformed key inputs without coercion: %p", (value) => {
    expect(validApiKey(value)).toBe(false);
  });
});
