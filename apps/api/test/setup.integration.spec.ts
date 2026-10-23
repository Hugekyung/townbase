import "reflect-metadata";
import { PrismaClient } from "@townbase/database";
import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DeploymentDatabase } from "../src/deployment/deployment-database";
import { SetupService } from "../src/setup/setup.service";
import { verifyPassword } from "../src/setup/password";

const integration =
  process.env.TOWNBASE_SETUP_INTEGRATION === "1" ? describe : describe.skip;
integration("initial administrator real database lifecycle", () => {
  let owner: PrismaClient;
  let runtime: DeploymentDatabase;
  let second: DeploymentDatabase;
  let service: SetupService;
  let other: SetupService;
  let directory: string;
  const original = {
    url: process.env.DATABASE_URL,
    bootstrap: process.env.TOWNBASE_BOOTSTRAP_PATH,
    documents: process.env.TOWNBASE_DOCUMENTS_PATH,
    attachments: process.env.TOWNBASE_ATTACHMENTS_PATH,
  };
  const password = "관리자만 알고 있는 안전한 비밀번호!";
  const hash = (v: string) => createHash("sha256").update(v).digest("hex");
  const input = (token: string) => ({ token, username: "운영자", password });
  const token = async () =>
    (await readFile(path.join(directory, "bootstrap/token"), "utf8")).trim();

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    if (url.hostname !== "postgres" || url.pathname !== "/townbase_b03_test")
      throw new Error("Dedicated B03 test DB required");
    owner = new PrismaClient({ datasources: { db: { url: url.toString() } } });
    url.username = "townbase_runtime";
    url.password = (
      await readFile(process.env.TOWNBASE_RUNTIME_PASSWORD_FILE!, "utf8")
    ).trim();
    process.env.DATABASE_URL = url.toString();
    runtime = new DeploymentDatabase();
    second = new DeploymentDatabase();
    service = new SetupService(runtime);
    other = new SetupService(second);
  });
  beforeEach(async () => {
    await owner.installationAuditEvent.deleteMany();
    await owner.administrator.deleteMany();
    await owner.installation.deleteMany();
    await owner.bootstrapState.update({
      where: { id: "primary" },
      data: {
        tokenHash: null,
        issuedAt: null,
        expiresAt: null,
        consumedAt: null,
        failedAttempts: 0,
        attemptWindowStart: null,
        blockedUntil: null,
      },
    });
    directory = await mkdtemp(path.join(os.tmpdir(), "townbase-b03-"));
    process.env.TOWNBASE_BOOTSTRAP_PATH = path.join(directory, "bootstrap");
    process.env.TOWNBASE_DOCUMENTS_PATH = path.join(directory, "documents");
    process.env.TOWNBASE_ATTACHMENTS_PATH = path.join(directory, "attachments");
    await mkdir(process.env.TOWNBASE_DOCUMENTS_PATH);
    await mkdir(process.env.TOWNBASE_ATTACHMENTS_PATH);
  });
  afterEach(async () => {
    service.onModuleDestroy();
    other.onModuleDestroy();
    await rm(directory, { recursive: true, force: true });
  });
  afterAll(async () => {
    await owner.installationAuditEvent.deleteMany();
    await owner.administrator.deleteMany();
    await owner.installation.deleteMany();
    await owner.$disconnect();
    await runtime.onApplicationShutdown();
    await second.onApplicationShutdown();
    for (const [key, value] of Object.entries({
      DATABASE_URL: original.url,
      TOWNBASE_BOOTSTRAP_PATH: original.bootstrap,
      TOWNBASE_DOCUMENTS_PATH: original.documents,
      TOWNBASE_ATTACHMENTS_PATH: original.attachments,
    })) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("issues a 32-byte file-only token, persists its digest and typed issuance audit", async () => {
    await service.issue();
    const raw = await token();
    expect(Buffer.from(raw, "base64url")).toHaveLength(32);
    expect((await stat(path.join(directory, "bootstrap"))).mode & 0o777).toBe(
      0o700,
    );
    expect(
      (await stat(path.join(directory, "bootstrap/token"))).mode & 0o777,
    ).toBe(0o600);
    const state = await owner.bootstrapState.findUniqueOrThrow({
      where: { id: "primary" },
    });
    expect(state.tokenHash).toBe(hash(raw));
    expect(JSON.stringify(state)).not.toContain(raw);
    expect(state.expiresAt!.getTime() - state.issuedAt!.getTime()).toBe(
      3600000,
    );
    expect(
      await owner.installationAuditEvent.count({
        where: { action: "bootstrap_token_issued" },
      }),
    ).toBe(1);
  });
  it("stores Argon2id and consumes the token atomically, with independent readback", async () => {
    await service.issue();
    const raw = await token();
    expect(await service.register(input(raw))).toBe("registered");
    const admin = await owner.administrator.findFirstOrThrow();
    expect(admin.passwordHash).toMatch(
      /^\$argon2id\$v=19\$m=19456,(?:t=2,p=1|p=1,t=2)\$/,
    );
    expect(await verifyPassword(admin.passwordHash, password)).toBe(true);
    expect(await other.status()).toEqual({ state: "complete" });
    expect(
      (await owner.installation.findFirstOrThrow()).initializedAt,
    ).not.toBeNull();
    expect(
      (await owner.bootstrapState.findFirstOrThrow()).tokenHash,
    ).toBeNull();
    expect(
      await owner.installationAuditEvent.count({
        where: { action: "bootstrap_token_consumed" },
      }),
    ).toBe(1);
    await expect(token()).rejects.toMatchObject({ code: "ENOENT" });
    expect(await other.register(input(raw))).toBe("closed");
    await expect(other.issue()).rejects.toThrow();
  });
  it("rejects wrong or absent tokens without consuming a valid credential", async () => {
    expect(await service.register(input("A".repeat(43)))).toBe("invalid_token");
    await service.issue();
    const raw = await token();
    expect(await service.register(input("B".repeat(43)))).toBe("invalid_token");
    expect((await owner.bootstrapState.findFirstOrThrow()).tokenHash).toBe(
      hash(raw),
    );
    expect(await service.register(input(raw))).toBe("registered");
  });
  it("expires credentials and physically cleans the file on service restart", async () => {
    await service.issue();
    const raw = await token();
    const now = Date.now();
    await owner.bootstrapState.update({
      where: { id: "primary" },
      data: {
        issuedAt: new Date(now - 7200000),
        expiresAt: new Date(now - 3600000),
      },
    });
    expect(await service.register(input(raw))).toBe("invalid_token");
    await other.onModuleInit();
    await expect(token()).rejects.toMatchObject({ code: "ENOENT" });
    expect(
      (await owner.bootstrapState.findFirstOrThrow()).tokenHash,
    ).toBeNull();
  });
  it("removes interrupted plaintext temporary writes while preserving a live token", async () => {
    await service.issue();
    const current = await token();
    const orphan = path.join(directory, "bootstrap", `.${randomUUID()}.tmp`);
    await writeFile(orphan, "synthetic-orphan-credential", { mode: 0o600 });
    await other.cleanup();
    await expect(readFile(orphan)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await token()).toBe(current);
    expect(await service.register(input(current))).toBe("registered");
  });
  it("rotates tokens and serializes simultaneous local issuance", async () => {
    await service.issue();
    const old = await token();
    await Promise.all([service.issue(), other.issue()]);
    const current = await token();
    expect(current).not.toBe(old);
    expect((await owner.bootstrapState.findFirstOrThrow()).tokenHash).toBe(
      hash(current),
    );
    expect(await service.register(input(old))).toBe("invalid_token");
    expect(await service.register(input(current))).toBe("registered");
  });
  it("creates exactly one administrator under concurrent requests from independent clients", async () => {
    await service.issue();
    const body = input(await token());
    const results = await Promise.all([
      service.register(body),
      other.register(body),
      service.register(body),
      other.register(body),
    ]);
    expect(results.filter((x) => x === "registered")).toHaveLength(1);
    expect(results.filter((x) => x === "closed")).toHaveLength(3);
    expect(await owner.administrator.count()).toBe(1);
  });
  it("persists throttling across clients and allows operator rotation to recover", async () => {
    await service.issue();
    for (let i = 0; i < 10; i++)
      expect(await service.register(input("A".repeat(43)))).toBe(
        "invalid_token",
      );
    expect(await other.register(input(await token()))).toBe("throttled");
    await other.issue();
    expect(await service.register(input(await token()))).toBe("registered");
  });
  it("rejects invalid field boundaries without silently trimming passwords", async () => {
    await service.issue();
    const raw = await token();
    for (const body of [
      { ...input(raw), password: "a".repeat(14) },
      { ...input(raw), password: "나".repeat(129) },
      { ...input(raw), username: "\n" },
      { ...input(raw), extra: true },
    ])
      expect(await service.register(body)).toBe("invalid_request");
    expect(
      await service.register({ ...input(raw), password: "나".repeat(15) }),
    ).toBe("registered");
    expect(
      await verifyPassword(
        (await owner.administrator.findFirstOrThrow()).passwordHash,
        "나".repeat(15),
      ),
    ).toBe(true);
  });
  it("fails closed for initialized installations even without an administrator row", async () => {
    await service.issue();
    await owner.installation.update({
      where: { id: "primary" },
      data: { initializedAt: new Date() },
    });
    expect(await service.register(input(await token()))).toBe("closed");
    await expect(service.issue()).rejects.toThrow();
  });
  it("rolls back administrator, initialization and token consumption if audit persistence fails", async () => {
    await service.issue();
    const raw = await token();
    await owner.$executeRaw`ALTER TABLE "InstallationAuditEvent" ADD CONSTRAINT "b03_audit_failure" CHECK (action <> 'administrator_created')`;
    try {
      await expect(service.register(input(raw))).rejects.toThrow();
    } finally {
      await owner.$executeRaw`ALTER TABLE "InstallationAuditEvent" DROP CONSTRAINT "b03_audit_failure"`;
    }
    expect(await owner.administrator.count()).toBe(0);
    expect(
      (await owner.installation.findFirstOrThrow()).initializedAt,
    ).toBeNull();
    expect((await owner.bootstrapState.findFirstOrThrow()).tokenHash).toBe(
      hash(raw),
    );
    expect(await token()).toBe(raw);
    expect(await service.register(input(raw))).toBe("registered");
  });
  it("does not reopen registration for a disabled administrator", async () => {
    await service.issue();
    const raw = await token();
    await service.register(input(raw));
    await owner.administrator.updateMany({ data: { disabledAt: new Date() } });
    expect(await other.register(input(raw))).toBe("closed");
    await expect(other.issue()).rejects.toThrow();
  });
  it("reports unavailable state if the required singleton is missing", async () => {
    await owner.bootstrapState.deleteMany();
    try {
      await expect(service.status()).rejects.toThrow();
      await expect(service.issue()).rejects.toThrow();
    } finally {
      await owner.bootstrapState.create({ data: { id: "primary" } });
    }
  });
  it("refuses token storage symlinks without changing the existing credential", async () => {
    await service.issue();
    const raw = await token();
    const link = path.join(directory, "alias");
    await symlink(path.join(directory, "documents"), link);
    process.env.TOWNBASE_BOOTSTRAP_PATH = link;
    await expect(other.issue()).rejects.toThrow();
    expect((await owner.bootstrapState.findFirstOrThrow()).tokenHash).toBe(
      hash(raw),
    );
    process.env.TOWNBASE_BOOTSTRAP_PATH = path.join(directory, "bootstrap");
    expect(await token()).toBe(raw);
  });
});
