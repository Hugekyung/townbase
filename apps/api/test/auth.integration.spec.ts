import "reflect-metadata";
import { PrismaClient } from "@townbase/database";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
  readdir,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { AuthService, credentialDigest } from "../src/auth/auth.service";
import { DeploymentDatabase } from "../src/deployment/deployment-database";
import { temporaryTokenName } from "../src/setup/token-file";
import { RecoveryIssueError } from "../src/auth/recovery-error";
import { SetupService } from "../src/setup/setup.service";
import { hashPassword, verifyPassword } from "../src/setup/password";
const integration =
  process.env.TOWNBASE_AUTH_INTEGRATION === "1" ? describe : describe.skip;
integration("administrator authentication real database lifecycle", () => {
  let owner: PrismaClient,
    runtime: DeploymentDatabase,
    second: DeploymentDatabase;
  let service: AuthService, other: AuthService;
  let directory: string;
  const original = { ...process.env };
  const password = "original safe password!";
  const nextPassword = "changed safe password!";
  const credentials = { username: "admin", password };
  const tokenFile = () => path.join(directory, "recovery/token");
  const rawRecovery = async () => (await readFile(tokenFile(), "utf8")).trim();
  const login = async (target = service) => {
    const result = await target.login(credentials);
    if (!result.ok) throw new Error(`Login failed: ${result.code}`);
    return result.token;
  };
  const resetRows = async () => {
    await owner.administratorSession.deleteMany();
    await owner.installationAuditEvent.deleteMany();
    await owner.administrator.deleteMany();
    await owner.installation.deleteMany();
    await owner.authenticationState.update({
      where: { id: "primary" },
      data: {
        loginFailures: 0,
        loginWindowStart: null,
        loginBlockedUntil: null,
        recoveryHash: null,
        recoveryIssuedAt: null,
        recoveryExpiresAt: null,
        recoveryConsumedAt: null,
        recoveryFailures: 0,
        recoveryWindowStart: null,
        recoveryBlockedUntil: null,
      },
    });
  };
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    if (url.hostname !== "postgres" || url.pathname !== "/townbase_b04_test")
      throw new Error("Dedicated B04 test DB required");
    owner = new PrismaClient({ datasources: { db: { url: url.toString() } } });
    url.username = "townbase_runtime";
    url.password = (
      await readFile(process.env.TOWNBASE_RUNTIME_PASSWORD_FILE!, "utf8")
    ).trim();
    process.env.DATABASE_URL = url.toString();
    runtime = new DeploymentDatabase();
    second = new DeploymentDatabase();
    service = new AuthService(runtime);
    other = new AuthService(second);
  });
  beforeEach(async () => {
    await resetRows();
    directory = await mkdtemp(path.join(os.tmpdir(), "townbase-b04-"));
    for (const [suffix, key] of [
      ["bootstrap", "TOWNBASE_BOOTSTRAP_PATH"],
      ["recovery", "TOWNBASE_RECOVERY_PATH"],
      ["documents", "TOWNBASE_DOCUMENTS_PATH"],
      ["attachments", "TOWNBASE_ATTACHMENTS_PATH"],
    ]) {
      process.env[key!] = path.join(directory, suffix!);
      await mkdir(process.env[key!]!);
    }
    const workspace = await owner.workspace.findFirstOrThrow();
    await owner.installation.create({
      data: {
        id: "primary",
        name: "B04 test",
        timeZone: "Asia/Seoul",
        workspaceId: workspace.id,
        initializedAt: new Date(),
      },
    });
    await owner.administrator.create({
      data: {
        installationId: "primary",
        username: "admin",
        passwordHash: await hashPassword(password),
      },
    });
  });
  afterEach(async () => {
    service.onModuleDestroy();
    other.onModuleDestroy();
    await rm(directory, { recursive: true, force: true });
  });
  afterAll(async () => {
    if (owner) {
      await resetRows();
      await owner.$disconnect();
    }
    await runtime?.onApplicationShutdown();
    await second?.onApplicationShutdown();
    process.env = original;
  });
  it("persists only session digests and supports readback across service instances", async () => {
    const token = await login();
    const row = await owner.administratorSession.findUniqueOrThrow({
      where: { tokenHash: credentialDigest(token) },
    });
    expect(JSON.stringify(row)).not.toContain(token);
    expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBe(8 * 3600000);
    expect(await other.current(token)).toMatchObject({
      ok: true,
      username: "admin",
    });
    expect(
      await owner.installationAuditEvent.count({
        where: {
          action: "administrator_logged_in",
          actorType: "administrator",
        },
      }),
    ).toBe(1);
    const refreshed = await owner.administratorSession.findUniqueOrThrow({
      where: { tokenHash: credentialDigest(token) },
    });
    expect(refreshed.lastSeenAt.getTime()).toBeGreaterThan(
      row.lastSeenAt.getTime(),
    );
  });
  it("rotates the previous cookie and rejects replay after logout", async () => {
    const first = await login();
    const result = await other.login(credentials, first);
    if (!result.ok) throw new Error("login failed");
    expect(await service.current(first)).toMatchObject({ ok: false });
    expect(await service.logout(result.token)).toEqual({ ok: true });
    expect(await other.current(result.token)).toMatchObject({ ok: false });
    expect(
      await owner.installationAuditEvent.count({
        where: { action: "administrator_logged_out" },
      }),
    ).toBe(1);
  });
  it("independently enforces idle expiration", async () => {
    const token = await login();
    const past = new Date(Date.now() - 31 * 60000);
    await owner.administratorSession.update({
      where: { tokenHash: credentialDigest(token) },
      data: { createdAt: past, lastSeenAt: past },
    });
    expect(await other.current(token)).toMatchObject({ ok: false });
  });
  it("independently enforces absolute expiration despite recent activity", async () => {
    const token = await login();
    await owner.administratorSession.update({
      where: { tokenHash: credentialDigest(token) },
      data: {
        createdAt: new Date(Date.now() - 9 * 3600000),
        expiresAt: new Date(Date.now() - 1000),
        lastSeenAt: new Date(Date.now() - 2000),
      },
    });
    expect(await other.current(token)).toMatchObject({ ok: false });
  });
  it.each(["disabled", "uninitialized"])(
    "rejects otherwise valid sessions and recovery for %s administrators",
    async (reason) => {
      const token = await login();
      await service.issueRecovery();
      const recovery = await rawRecovery();
      if (reason === "disabled")
        await owner.administrator.updateMany({
          data: { disabledAt: new Date() },
        });
      else
        await owner.installation.update({
          where: { id: "primary" },
          data: { initializedAt: null },
        });
      expect(await other.current(token)).toMatchObject({ ok: false });
      expect(await other.login(credentials)).toMatchObject({ ok: false });
      expect(
        await other.recover({ token: recovery, newPassword: nextPassword }),
      ).toMatchObject({ ok: false });
      await expect(other.issueRecovery()).rejects.toThrow();
    },
  );
  it("persists login throttling across instances and distinguishes wrong username/password", async () => {
    expect(await service.login({ ...credentials, username: "wrong" })).toEqual({
      ok: false,
      code: "unauthorized",
    });
    for (let i = 0; i < 9; i++)
      await service.login({ ...credentials, password: "wrong safe password!" });
    expect(await other.login(credentials)).toEqual({
      ok: false,
      code: "throttled",
    });
    expect(
      (await owner.authenticationState.findFirstOrThrow()).loginFailures,
    ).toBe(10);
    await owner.authenticationState.update({
      where: { id: "primary" },
      data: {
        loginWindowStart: new Date(Date.now() - 16 * 60000),
        loginBlockedUntil: new Date(0),
      },
    });
    expect(await other.login(credentials)).toMatchObject({ ok: true });
  });
  it("validates exact inputs and does not trim password whitespace", async () => {
    expect(await service.login({ ...credentials, extra: true })).toMatchObject({
      ok: false,
      code: "invalid_request",
    });
    expect(
      await service.login({ ...credentials, password: ` ${password}` }),
    ).toMatchObject({ ok: false });
    expect(await service.login(null)).toMatchObject({
      ok: false,
      code: "invalid_request",
    });
  });
  it("requires current password, changes its hash and revokes all sessions/recovery", async () => {
    const first = await login(),
      secondToken = await login(other);
    await service.issueRecovery();
    const recovery = await rawRecovery();
    expect(
      await service.changePassword(first, {
        currentPassword: "incorrect safe password",
        newPassword: nextPassword,
      }),
    ).toMatchObject({ ok: false });
    expect(
      await service.changePassword(first, {
        currentPassword: password,
        newPassword: nextPassword,
      }),
    ).toEqual({ ok: true });
    expect(await other.current(first)).toMatchObject({ ok: false });
    expect(await other.current(secondToken)).toMatchObject({ ok: false });
    expect(
      await other.recover({ token: recovery, newPassword: password }),
    ).toMatchObject({ ok: false });
    expect(await other.login(credentials)).toMatchObject({ ok: false });
    expect(
      await other.login({ ...credentials, password: nextPassword }),
    ).toMatchObject({ ok: true });
    await expect(readFile(tokenFile())).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
  it("issues a file-only 32-byte 60-minute recovery token and rotates it", async () => {
    await service.issueRecovery();
    const first = await rawRecovery();
    await other.issueRecovery();
    const secondToken = await rawRecovery();
    expect(Buffer.from(secondToken, "base64url")).toHaveLength(32);
    expect(secondToken).not.toBe(first);
    expect((await stat(tokenFile())).mode & 0o777).toBe(0o600);
    expect((await stat(path.dirname(tokenFile()))).mode & 0o777).toBe(0o700);
    const state = await owner.authenticationState.findFirstOrThrow();
    expect(state.recoveryHash).toBe(credentialDigest(secondToken));
    expect(JSON.stringify(state)).not.toContain(secondToken);
    expect(
      state.recoveryExpiresAt!.getTime() - state.recoveryIssuedAt!.getTime(),
    ).toBe(3600000);
    expect(
      await other.recover({ token: first, newPassword: nextPassword }),
    ).toMatchObject({ ok: false });
  });
  it("consumes recovery exactly once under concurrent requests and preserves workspace/admin", async () => {
    const sessions = [await login(), await login(other)];
    const workspace = await owner.workspace.findFirstOrThrow(),
      admin = await owner.administrator.findFirstOrThrow();
    await service.issueRecovery();
    const raw = await rawRecovery();
    const results = await Promise.all([
      service.recover({ token: raw, newPassword: nextPassword }),
      other.recover({ token: raw, newPassword: nextPassword }),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    for (const token of sessions)
      expect(await other.current(token)).toMatchObject({ ok: false });
    expect(
      await owner.workspace.findUniqueOrThrow({ where: { id: workspace.id } }),
    ).toEqual(workspace);
    const changed = await owner.administrator.findFirstOrThrow();
    expect(changed.id).toBe(admin.id);
    expect(await verifyPassword(changed.passwordHash, nextPassword)).toBe(true);
    expect(
      await owner.installationAuditEvent.count({
        where: { action: "recovery_token_consumed" },
      }),
    ).toBe(1);
    await expect(rawRecovery()).rejects.toMatchObject({ code: "ENOENT" });
    await expect(new SetupService(runtime).issue()).rejects.toThrow();
  });
  it("rejects expired recovery and physically cleans the token file", async () => {
    await service.issueRecovery();
    const raw = await rawRecovery();
    await owner.authenticationState.update({
      where: { id: "primary" },
      data: {
        recoveryIssuedAt: new Date(Date.now() - 2 * 3600000),
        recoveryExpiresAt: new Date(Date.now() - 1000),
      },
    });
    expect(
      await other.recover({ token: raw, newPassword: nextPassword }),
    ).toMatchObject({ ok: false });
    await other.cleanup();
    expect(
      (await owner.authenticationState.findFirstOrThrow()).recoveryHash,
    ).toBeNull();
    await expect(rawRecovery()).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("persists recovery rate limits independently of login", async () => {
    await service.issueRecovery();
    const raw = await rawRecovery();
    for (let i = 0; i < 10; i++)
      await service.recover({
        token: "a".repeat(43),
        newPassword: nextPassword,
      });
    expect(
      await other.recover({ token: raw, newPassword: nextPassword }),
    ).toEqual({ ok: false, code: "throttled" });
    expect(await other.login(credentials)).toMatchObject({ ok: true });
  });
  it("does not consume a valid recovery token for an invalid new password", async () => {
    await service.issueRecovery();
    const raw = await rawRecovery();
    expect(
      await service.recover({ token: raw, newPassword: "short" }),
    ).toMatchObject({ ok: false, code: "invalid_request" });
    expect(
      (await owner.authenticationState.findFirstOrThrow()).recoveryHash,
    ).toBe(credentialDigest(raw));
    expect(
      await other.recover({ token: raw, newPassword: nextPassword }),
    ).toEqual({ ok: true });
  });
  it("serializes cleanup with issuance without deleting the newly issued token", async () => {
    await Promise.all([service.cleanup(), other.issueRecovery()]);
    const raw = await rawRecovery();
    expect(
      (await owner.authenticationState.findFirstOrThrow()).recoveryHash,
    ).toBe(credentialDigest(raw));
    expect(
      await service.recover({ token: raw, newPassword: nextPassword }),
    ).toEqual({ ok: true });
  });
  it("checks expiry after acquiring the authentication lock", async () => {
    await service.issueRecovery();
    const raw = await rawRecovery();
    await owner.authenticationState.update({
      where: { id: "primary" },
      data: { recoveryExpiresAt: new Date(Date.now() + 300) },
    });
    let acquired!: () => void, release!: () => void;
    const locked = new Promise<void>((resolve) => {
      acquired = resolve;
    });
    const proceed = new Promise<void>((resolve) => {
      release = resolve;
    });
    const holder = owner.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "AuthenticationState" WHERE id='primary' FOR UPDATE`;
      acquired();
      await proceed;
    });
    await locked;
    const result = other.recover({ token: raw, newPassword: nextPassword });
    await new Promise((resolve) => setTimeout(resolve, 400));
    release();
    await holder;
    expect(await result).toMatchObject({ ok: false });
  });
  it("rolls back issuance if protected file writing fails", async () => {
    await mkdir(tokenFile());
    await expect(service.issueRecovery()).rejects.toMatchObject({
      code: "storage_unavailable",
    });
    expect(
      (await owner.authenticationState.findFirstOrThrow()).recoveryHash,
    ).toBeNull();
    expect(
      await owner.installationAuditEvent.count({
        where: { action: "recovery_token_issued" },
      }),
    ).toBe(0);
  });
  it("removes stale issuance files under the lock without deleting unrelated files", async () => {
    const stale = path.join(directory, "recovery", temporaryTokenName());
    const unrelated = path.join(directory, "recovery", "operator-note");
    await writeFile(stale, "synthetic stale secret", { mode: 0o600 });
    await writeFile(unrelated, "keep");
    await service.issueRecovery();
    expect(await readdir(path.join(directory, "recovery"))).toEqual(
      expect.arrayContaining(["token", "operator-note"]),
    );
    await expect(readFile(stale)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(unrelated, "utf8")).toBe("keep");
  });
  it("reports unavailable administrators separately from protected storage failures", async () => {
    await owner.administrator.updateMany({ data: { disabledAt: new Date() } });
    await expect(service.issueRecovery()).rejects.toMatchObject({
      code: "administrator_unavailable",
    });
    process.env.TOWNBASE_RECOVERY_PATH = process.env.TOWNBASE_DOCUMENTS_PATH;
    await expect(service.issueRecovery()).rejects.toBeInstanceOf(
      RecoveryIssueError,
    );
    await expect(service.issueRecovery()).rejects.toMatchObject({
      code: "storage_unavailable",
    });
  });
  it("allows session reads under another shared boundary while keeping revocation exclusive", async () => {
    const token = await login();
    let acquired!: () => void, release!: () => void;
    const locked = new Promise<void>((resolve) => {
      acquired = resolve;
    });
    const proceed = new Promise<void>((resolve) => {
      release = resolve;
    });
    const holder = owner.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "AuthenticationState" WHERE id='primary' FOR SHARE`;
      acquired();
      await proceed;
    });
    await locked;
    try {
      expect(await other.current(token)).toMatchObject({ ok: true });
      let completed = false;
      const logout = service.logout(token).then((result) => {
        completed = true;
        return result;
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(completed).toBe(false);
      release();
      await holder;
      expect(await logout).toEqual({ ok: true });
      expect(await other.current(token)).toMatchObject({ ok: false });
    } finally {
      release();
      await holder;
    }
  });
  it("checks idle expiry after waiting for the session row lock", async () => {
    const token = await login(),
      hash = credentialDigest(token);
    const activity = new Date(Date.now() - 30 * 60000 + 300);
    await owner.administratorSession.update({
      where: { tokenHash: hash },
      data: { createdAt: activity, lastSeenAt: activity },
    });
    let acquired!: () => void, release!: () => void;
    const locked = new Promise<void>((resolve) => {
      acquired = resolve;
    });
    const proceed = new Promise<void>((resolve) => {
      release = resolve;
    });
    const holder = owner.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "tokenHash" FROM "AdministratorSession" WHERE "tokenHash"=${hash} FOR UPDATE`;
      acquired();
      await proceed;
    });
    await locked;
    try {
      const result = other.current(token);
      await new Promise((resolve) => setTimeout(resolve, 400));
      release();
      await holder;
      expect(await result).toMatchObject({ ok: false });
    } finally {
      release();
      await holder;
    }
  });
  it("rolls back password changes and session revocation when audit persistence fails", async () => {
    const token = await login();
    const admin = await owner.administrator.findFirstOrThrow();
    await owner.$executeRaw`CREATE FUNCTION public."_B04RejectAudit"() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RAISE EXCEPTION ''B04 test audit failure''; END'`;
    await owner.$executeRaw`REVOKE ALL ON FUNCTION public."_B04RejectAudit"() FROM PUBLIC`;
    await owner.$executeRaw`CREATE TRIGGER "_B04RejectAudit" BEFORE INSERT ON "InstallationAuditEvent" FOR EACH ROW EXECUTE FUNCTION public."_B04RejectAudit"()`;
    try {
      await expect(
        service.changePassword(token, {
          currentPassword: password,
          newPassword: nextPassword,
        }),
      ).rejects.toThrow();
      expect((await owner.administrator.findFirstOrThrow()).passwordHash).toBe(
        admin.passwordHash,
      );
      expect(await other.current(token)).toMatchObject({ ok: true });
    } finally {
      await owner.$executeRaw`DROP TRIGGER "_B04RejectAudit" ON "InstallationAuditEvent"`;
      await owner.$executeRaw`DROP FUNCTION public."_B04RejectAudit"()`;
    }
  });
});
