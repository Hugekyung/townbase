import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { PrismaClient } from "@townbase/database";
import { RecoveryIssueError } from "./recovery-error";
import { DeploymentDatabase } from "../deployment/deployment-database";
import { hashPassword, verifyPassword, validPassword } from "../setup/password";
import {
  prepareTokenDirectory,
  writeTokenFile,
  deleteTokenFile,
  deleteTemporaryTokenFiles,
} from "../setup/token-file";
import {
  AUTH_WINDOW_MS,
  RECOVERY_TTL_MS,
  SESSION_ABSOLUTE_MS,
  SESSION_IDLE_MS,
  fields,
} from "./auth-policy";

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
type InstallationAuditAction = Parameters<
  Tx["installationAuditEvent"]["create"]
>[0]["data"]["action"];
type Failure = {
  ok: false;
  code: "invalid_request" | "unauthorized" | "throttled";
};
type Result<T = Record<never, never>> = ({ ok: true } & T) | Failure;
export const credentialDigest = (token: string) =>
  createHash("sha256").update(token).digest("hex");
const validToken = (token: unknown): token is string =>
  typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);

export type AdministratorContext = Readonly<{
  administratorId: string;
  installationId: string;
  workspaceId: string;
  username: string;
  expiresAt: string;
}>;
@Injectable()
export class AuthService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private readonly dummyHash = hashPassword(
    randomBytes(32).toString("base64url"),
  );
  constructor(private readonly database: DeploymentDatabase) {}
  async onModuleInit() {
    await prepareTokenDirectory("recovery");
    await this.cleanup().catch(() => this.warning());
    this.timer = setInterval(() => {
      void this.cleanup().catch(() => this.warning());
    }, 60000);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  private warning() {
    Logger.warn(
      "Recovery token cleanup unavailable. Check protected storage and database.",
    );
  }
  private async transaction<T>(
    work: (tx: Tx, now: Date) => Promise<T>,
    sharedBoundary = false,
  ): Promise<T> {
    return this.database.prisma.$transaction(
      async (tx) => {
        // Session checks share the revocation boundary; mutations remain exclusive.
        const rows = sharedBoundary
          ? await tx.$queryRaw<
              Array<{ id: string }>
            >`SELECT id FROM "AuthenticationState" WHERE id = 'primary' FOR SHARE`
          : await tx.$queryRaw<
              Array<{ id: string }>
            >`SELECT id FROM "AuthenticationState" WHERE id = 'primary' FOR UPDATE`;
        if (rows.length !== 1)
          throw new Error("Authentication storage unavailable");
        const [clock] = await tx.$queryRaw<
          Array<{ now: Date }>
        >`SELECT clock_timestamp() AS now`;
        if (!clock) throw new Error("Authentication clock unavailable");
        return work(tx, clock.now);
      },
      { timeout: 30000, maxWait: 3000 },
    );
  }
  private async administrator(tx: Tx) {
    const installation = await tx.installation.findUnique({
      where: { id: "primary" },
      select: { initializedAt: true },
    });
    if (installation?.initializedAt == null) return null;
    return tx.administrator.findFirst({
      where: { installationId: "primary", disabledAt: null },
    });
  }
  private async audit(
    tx: Tx,
    action: InstallationAuditAction,
    administratorId?: string,
    succeeded = true,
  ) {
    await tx.installationAuditEvent.create({
      data: {
        installationId: "primary",
        action,
        actorType: administratorId ? "administrator" : "server",
        actorAdministratorId: administratorId ?? null,
        outcome: succeeded ? "succeeded" : "failed",
        requestId: randomUUID(),
      },
    });
  }
  private async reject(tx: Tx, now: Date, lane: "login" | "recovery") {
    const state = await tx.authenticationState.findUniqueOrThrow({
      where: { id: "primary" },
    });
    const start =
      lane === "login" ? state.loginWindowStart : state.recoveryWindowStart;
    const old = lane === "login" ? state.loginFailures : state.recoveryFailures;
    const inWindow =
      start != null && now.getTime() - start.getTime() < AUTH_WINDOW_MS;
    const failures = inWindow ? old + 1 : 1;
    const blocked =
      failures >= 10
        ? new Date(
            now.getTime() +
              Math.min(60000, 1000 * 2 ** Math.min(6, failures - 10)),
          )
        : null;
    await tx.authenticationState.update({
      where: { id: "primary" },
      data:
        lane === "login"
          ? {
              loginFailures: failures,
              loginWindowStart: inWindow ? start : now,
              loginBlockedUntil: blocked,
            }
          : {
              recoveryFailures: failures,
              recoveryWindowStart: inWindow ? start : now,
              recoveryBlockedUntil: blocked,
            },
    });
    if (await tx.installation.count())
      await this.audit(
        tx,
        lane === "login"
          ? "administrator_login_rejected"
          : "recovery_token_rejected",
        undefined,
        false,
      );
  }
  private async resetLogin(tx: Tx) {
    await tx.authenticationState.update({
      where: { id: "primary" },
      data: {
        loginFailures: 0,
        loginWindowStart: null,
        loginBlockedUntil: null,
      },
    });
  }
  private async session(tx: Tx, token: string | undefined, now: Date) {
    if (!validToken(token)) return null;
    const session = await tx.administratorSession.findUnique({
      where: { tokenHash: credentialDigest(token) },
    });
    if (
      !session ||
      session.revokedAt != null ||
      session.expiresAt <= now ||
      now.getTime() - session.lastSeenAt.getTime() >= SESSION_IDLE_MS
    )
      return null;
    const administrator = await this.administrator(tx);
    if (
      !administrator ||
      session.installationId !== administrator.installationId ||
      session.administratorId !== administrator.id
    )
      return null;
    return { session, administrator };
  }
  async login(
    body: unknown,
    previousToken?: string,
  ): Promise<Result<{ token: string; username: string }>> {
    return this.transaction(async (tx, now) => {
      const state = await tx.authenticationState.findUniqueOrThrow({
        where: { id: "primary" },
      });
      if (state.loginBlockedUntil != null && state.loginBlockedUntil > now)
        return { ok: false, code: "throttled" };
      const valid =
        fields(body, ["username", "password"]) &&
        typeof body.username === "string" &&
        body.username.trim().length > 0 &&
        [...body.username.trim()].length <= 128 &&
        !/[\p{Cc}]/u.test(body.username) &&
        validPassword(body.password);
      const administrator = await this.administrator(tx);
      const password = valid ? (body.password as string) : "invalid-input";
      const matches = await verifyPassword(
        administrator?.passwordHash ?? (await this.dummyHash),
        password,
      );
      if (
        !valid ||
        !administrator ||
        !matches ||
        (body.username as string).trim() !== administrator.username
      ) {
        await this.reject(tx, now, "login");
        return { ok: false, code: valid ? "unauthorized" : "invalid_request" };
      }
      if (validToken(previousToken))
        await tx.administratorSession.updateMany({
          where: {
            tokenHash: credentialDigest(previousToken),
            revokedAt: null,
          },
          data: { revokedAt: now },
        });
      const token = randomBytes(32).toString("base64url");
      await tx.administratorSession.create({
        data: {
          tokenHash: credentialDigest(token),
          installationId: "primary",
          administratorId: administrator.id,
          createdAt: now,
          lastSeenAt: now,
          expiresAt: new Date(now.getTime() + SESSION_ABSOLUTE_MS),
        },
      });
      await this.resetLogin(tx);
      await this.audit(tx, "administrator_logged_in", administrator.id);
      return { ok: true, token, username: administrator.username };
    });
  }
  async current(
    token?: string,
  ): Promise<Result<{ username: string; expiresAt: string }>> {
    return this.withActiveSession(token, (context) => ({
      username: context.username,
      expiresAt: context.expiresAt,
    }));
  }
  async requester(
    token?: string,
  ): Promise<Result<{ requester: AdministratorContext }>> {
    return this.withActiveSession(token, (context) => ({ requester: context }));
  }
  private async withActiveSession<T extends object>(
    token: string | undefined,
    result: (context: AdministratorContext) => T,
  ): Promise<Result<T>> {
    if (!validToken(token)) return { ok: false, code: "unauthorized" };
    return this.transaction(async (tx) => {
      await tx.$queryRaw`SELECT "tokenHash" FROM "AdministratorSession" WHERE "tokenHash"=${credentialDigest(token)} FOR UPDATE`;
      const [clock] = await tx.$queryRaw<
        Array<{ now: Date }>
      >`SELECT clock_timestamp() AS now`;
      if (!clock) throw new Error("Authentication clock unavailable");
      const auth = await this.session(tx, token, clock.now);
      if (!auth) return { ok: false, code: "unauthorized" };
      const installation = await tx.installation.findUnique({
        where: { id: auth.administrator.installationId },
        select: { id: true, workspaceId: true, initializedAt: true },
      });
      if (installation?.initializedAt == null)
        return { ok: false, code: "unauthorized" };
      const workspace = await tx.workspace.findUnique({
        where: { id: installation.workspaceId },
        select: { id: true },
      });
      if (!workspace) return { ok: false, code: "unauthorized" };
      await tx.administratorSession.update({
        where: { tokenHash: auth.session.tokenHash },
        data: { lastSeenAt: clock.now },
      });
      return {
        ok: true,
        ...result({
          administratorId: auth.administrator.id,
          installationId: installation.id,
          workspaceId: workspace.id,
          username: auth.administrator.username,
          expiresAt: auth.session.expiresAt.toISOString(),
        }),
      };
    }, true);
  }

  async logout(token?: string): Promise<Result> {
    return this.transaction(async (tx, now) => {
      const auth = await this.session(tx, token, now);
      if (!auth) return { ok: false, code: "unauthorized" };
      await tx.administratorSession.update({
        where: { tokenHash: auth.session.tokenHash },
        data: { revokedAt: now },
      });
      await this.audit(tx, "administrator_logged_out", auth.administrator.id);
      return { ok: true };
    });
  }
  async changePassword(
    token: string | undefined,
    body: unknown,
  ): Promise<Result> {
    const result = await this.transaction<Result>(async (tx, now) => {
      const auth = await this.session(tx, token, now);
      if (!auth) return { ok: false, code: "unauthorized" };
      const state = await tx.authenticationState.findUniqueOrThrow({
        where: { id: "primary" },
      });
      if (state.loginBlockedUntil != null && state.loginBlockedUntil > now)
        return { ok: false, code: "throttled" };
      if (
        !fields(body, ["currentPassword", "newPassword"]) ||
        !validPassword(body.currentPassword) ||
        !validPassword(body.newPassword)
      ) {
        await this.reject(tx, now, "login");
        return { ok: false, code: "invalid_request" };
      }
      if (
        !(await verifyPassword(
          auth.administrator.passwordHash,
          body.currentPassword,
        ))
      ) {
        await this.reject(tx, now, "login");
        return { ok: false, code: "unauthorized" };
      }
      await tx.administrator.update({
        where: { id: auth.administrator.id },
        data: { passwordHash: await hashPassword(body.newPassword) },
      });
      await tx.administratorSession.updateMany({
        where: { installationId: "primary", revokedAt: null },
        data: { revokedAt: now },
      });
      await tx.authenticationState.update({
        where: { id: "primary" },
        data: { recoveryHash: null },
      });
      await this.resetLogin(tx);
      await this.audit(
        tx,
        "administrator_password_changed",
        auth.administrator.id,
      );
      return { ok: true };
    });
    if (result.ok) await this.cleanup().catch(() => this.warning());
    return result;
  }
  async issueRecovery(): Promise<void> {
    await prepareTokenDirectory("recovery").catch(() => {
      throw new RecoveryIssueError("storage_unavailable");
    });
    await this.transaction(async (tx, now) => {
      await deleteTemporaryTokenFiles("recovery").catch(() => {
        throw new RecoveryIssueError("storage_unavailable");
      });
      if (!(await this.administrator(tx)))
        throw new RecoveryIssueError("administrator_unavailable");
      const token = randomBytes(32).toString("base64url");
      await tx.authenticationState.update({
        where: { id: "primary" },
        data: {
          recoveryHash: credentialDigest(token),
          recoveryIssuedAt: now,
          recoveryExpiresAt: new Date(now.getTime() + RECOVERY_TTL_MS),
          recoveryConsumedAt: null,
          recoveryFailures: 0,
          recoveryWindowStart: null,
          recoveryBlockedUntil: null,
        },
      });
      await this.audit(tx, "recovery_token_issued");
      await writeTokenFile(token, "recovery").catch(() => {
        throw new RecoveryIssueError("storage_unavailable");
      });
    });
  }
  async recover(body: unknown): Promise<Result> {
    const result = await this.transaction<Result>(async (tx, now) => {
      const state = await tx.authenticationState.findUniqueOrThrow({
        where: { id: "primary" },
      });
      if (
        state.recoveryBlockedUntil != null &&
        state.recoveryBlockedUntil > now
      )
        return { ok: false, code: "throttled" };
      const valid =
        fields(body, ["token", "newPassword"]) &&
        validToken(body.token) &&
        validPassword(body.newPassword);
      const matches =
        valid &&
        state.recoveryHash != null &&
        timingSafeEqual(
          Buffer.from(credentialDigest(body.token as string), "hex"),
          Buffer.from(state.recoveryHash, "hex"),
        );
      const administrator = await this.administrator(tx);
      if (
        !matches ||
        state.recoveryExpiresAt == null ||
        state.recoveryExpiresAt <= now ||
        state.recoveryConsumedAt != null ||
        !administrator
      ) {
        await this.reject(tx, now, "recovery");
        return { ok: false, code: valid ? "unauthorized" : "invalid_request" };
      }
      await tx.administrator.update({
        where: { id: administrator.id },
        data: { passwordHash: await hashPassword(body.newPassword as string) },
      });
      await tx.administratorSession.updateMany({
        where: { installationId: "primary", revokedAt: null },
        data: { revokedAt: now },
      });
      await tx.authenticationState.update({
        where: { id: "primary" },
        data: {
          recoveryHash: null,
          recoveryConsumedAt: now,
          recoveryFailures: 0,
          recoveryWindowStart: null,
          recoveryBlockedUntil: null,
        },
      });
      await this.resetLogin(tx);
      await this.audit(tx, "recovery_token_consumed");
      await this.audit(tx, "administrator_password_changed");
      return { ok: true };
    });
    if (result.ok) await this.cleanup().catch(() => this.warning());
    return result;
  }
  async cleanup(): Promise<void> {
    await this.transaction(async (tx, now) => {
      const state = await tx.authenticationState.findUniqueOrThrow({
        where: { id: "primary" },
      });
      await deleteTemporaryTokenFiles("recovery");
      if (
        state.recoveryHash == null ||
        state.recoveryExpiresAt == null ||
        state.recoveryExpiresAt <= now
      ) {
        if (state.recoveryHash != null)
          await tx.authenticationState.update({
            where: { id: "primary" },
            data: { recoveryHash: null },
          });
        await deleteTokenFile("recovery");
      }
    });
  }
}
