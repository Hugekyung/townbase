import { Injectable } from "@nestjs/common";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";

export type CredentialPurpose = "answer" | "embedding";
export type CredentialEnvelope = Readonly<{
  formatVersion: number;
  keyId: string;
  nonce: string;
  ciphertext: string;
  tag: string;
}>;
export class CredentialStorageError extends Error {
  constructor(
    readonly code: "master_key_unavailable" | "credential_unavailable",
  ) {
    super(code);
  }
}
export function validApiKey(value: unknown): value is string {
  return typeof value === "string" && /^[\x21-\x7e]{16,512}$/.test(value);
}
function decode(value: string, bytes?: number): Buffer {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value))
    throw new Error("Credential unavailable");
  const decoded = Buffer.from(value, "base64url");
  if (
    decoded.toString("base64url") !== value ||
    (bytes != null && decoded.length !== bytes)
  )
    throw new Error("Credential unavailable");
  return decoded;
}
@Injectable()
export class CredentialVault {
  private async master(): Promise<Buffer> {
    try {
      const filename = process.env.TOWNBASE_MASTER_KEY_FILE;
      if (!filename) throw new Error("Credential storage unavailable");
      const file = await open(
        filename,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      try {
        const stat = await file.stat();
        // Secret is mounted read-only only in the API; its host parent is 0700.
        if (!stat.isFile() || stat.size > 128 || (stat.mode & 0o222) !== 0)
          throw new Error("Credential storage unavailable");
        return decode((await file.readFile("utf8")).trim(), 32);
      } finally {
        await file.close();
      }
    } catch {
      throw new CredentialStorageError("master_key_unavailable");
    }
  }
  private aad(
    installationId: string,
    purpose: CredentialPurpose,
    keyId: string,
  ): Buffer {
    return Buffer.from(
      JSON.stringify(["townbase-key", 1, keyId, installationId, purpose]),
    );
  }
  async seal(
    installationId: string,
    purpose: CredentialPurpose,
    apiKey: string,
  ): Promise<CredentialEnvelope> {
    if (!validApiKey(apiKey)) throw new Error("Credential unavailable");
    const master = await this.master();
    try {
      const keyId = createHash("sha256").update(master).digest("hex");
      const nonce = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", master, nonce);
      cipher.setAAD(this.aad(installationId, purpose, keyId));
      const ciphertext = Buffer.concat([
        cipher.update(apiKey, "utf8"),
        cipher.final(),
      ]);
      return {
        formatVersion: 1,
        keyId,
        nonce: nonce.toString("base64url"),
        ciphertext: ciphertext.toString("base64url"),
        tag: cipher.getAuthTag().toString("base64url"),
      };
    } catch {
      throw new CredentialStorageError("credential_unavailable");
    } finally {
      master.fill(0);
    }
  }
  async reveal(
    installationId: string,
    purpose: CredentialPurpose,
    envelope: CredentialEnvelope,
  ): Promise<string> {
    const master = await this.master();
    try {
      const keyId = createHash("sha256").update(master).digest("hex");
      if (envelope.formatVersion !== 1 || envelope.keyId !== keyId)
        throw new Error("Credential unavailable");
      const decipher = createDecipheriv(
        "aes-256-gcm",
        master,
        decode(envelope.nonce, 12),
      );
      decipher.setAAD(this.aad(installationId, purpose, keyId));
      decipher.setAuthTag(decode(envelope.tag, 16));
      if (envelope.ciphertext.length > 683)
        throw new Error("Credential unavailable");
      const value = Buffer.concat([
        decipher.update(decode(envelope.ciphertext)),
        decipher.final(),
      ]).toString("utf8");
      if (!validApiKey(value)) throw new Error("Credential unavailable");
      return value;
    } catch {
      throw new CredentialStorageError("credential_unavailable");
    } finally {
      master.fill(0);
    }
  }
}
