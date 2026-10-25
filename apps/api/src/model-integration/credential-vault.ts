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
// One-operation master snapshot. Callers must dispose before network I/O.
export type PreparedCredentialReader = Readonly<{
  reveal: (
    installationId: string,
    purpose: CredentialPurpose,
    envelope: CredentialEnvelope,
  ) => string;
  dispose: () => void;
}>;
export class CredentialStorageError extends Error {
  constructor(
    readonly code: "master_key_unavailable" | "credential_unavailable",
  ) {
    super(code);
  }
}
// Format v1 encrypts printable ASCII. SQL compatibility is tested at this bound.
export const API_KEY_MIN_LENGTH = 16;
export const API_KEY_MAX_LENGTH = 512;
export const MAX_CIPHERTEXT_LENGTH = Math.ceil((API_KEY_MAX_LENGTH * 8) / 6);
export function validApiKey(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= API_KEY_MIN_LENGTH &&
    value.length <= API_KEY_MAX_LENGTH &&
    /^[\x21-\x7e]+$/.test(value)
  );
}
function decode(value: string, bytes?: number): Buffer {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value))
    throw new Error("Credential unavailable");
  const decoded = Buffer.from(value, "base64url");
  if (
    decoded.toString("base64url") !== value ||
    (bytes != null && decoded.length !== bytes)
  ) {
    decoded.fill(0);
    throw new Error("Credential unavailable");
  }
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
  async prepareReader(): Promise<PreparedCredentialReader> {
    const master = await this.master();
    let disposed = false;
    return {
      reveal: (installationId, purpose, envelope) => {
        if (disposed)
          throw new CredentialStorageError("credential_unavailable");
        return this.revealPrepared(master, installationId, purpose, envelope);
      },
      dispose: () => {
        disposed = true;
        master.fill(0);
      },
    };
  }
  async reveal(
    installationId: string,
    purpose: CredentialPurpose,
    envelope: CredentialEnvelope,
  ): Promise<string> {
    const prepared = await this.prepareReader();
    try {
      return prepared.reveal(installationId, purpose, envelope);
    } finally {
      prepared.dispose();
    }
  }
  private revealPrepared(
    master: Buffer,
    installationId: string,
    purpose: CredentialPurpose,
    envelope: CredentialEnvelope,
  ): string {
    const plaintextBuffers: Buffer[] = [];
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
      if (envelope.ciphertext.length > MAX_CIPHERTEXT_LENGTH)
        throw new Error("Credential unavailable");
      // Track the early update buffer before final() authenticates: final may throw.
      plaintextBuffers.push(decipher.update(decode(envelope.ciphertext)));
      plaintextBuffers.push(decipher.final());
      const plaintext = Buffer.concat(plaintextBuffers);
      plaintextBuffers.push(plaintext);
      const value = plaintext.toString("utf8");
      if (!validApiKey(value)) throw new Error("Credential unavailable");
      return value;
    } catch {
      throw new CredentialStorageError("credential_unavailable");
    } finally {
      for (const buffer of plaintextBuffers) buffer.fill(0);
    }
  }
}
