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
import { DeploymentDatabase } from "../deployment/deployment-database";
import { hashPassword } from "./password";
import {
  deleteTokenFile,
  deleteTemporaryTokenFiles,
  prepareTokenDirectory,
  writeTokenFile,
} from "./token-file";

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
export type SetupOutcome =
  | "registered"
  | "closed"
  | "invalid_request"
  | "invalid_token"
  | "throttled";
const digest = (token: string) =>
  createHash("sha256").update(token).digest("hex");

@Injectable()
export class SetupService implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | undefined;
  constructor(private readonly database: DeploymentDatabase) {}

  async onModuleInit() {
    await prepareTokenDirectory();
    await this.cleanup().catch(() => this.cleanupWarning());
    this.timer = setInterval(() => {
      void this.cleanup().catch(() => this.cleanupWarning());
    }, 60000);
    this.timer.unref();
  }
  private cleanupWarning() {
    Logger.warn(
      "Bootstrap token cleanup unavailable. Check protected storage and database.",
    );
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async closed(tx: Tx): Promise<boolean> {
    const [installation, administrators] = await Promise.all([
      tx.installation.findUnique({
        where: { id: "primary" },
        select: { initializedAt: true },
      }),
      tx.administrator.count(),
    ]);
    return installation?.initializedAt != null || administrators !== 0;
  }

  private async lock(tx: Tx): Promise<Date> {
    const rows = await tx.$queryRaw<
      Array<{ id: string }>
    >`SELECT id FROM "BootstrapState" WHERE id = 'primary' FOR UPDATE`;
    const [row] = await tx.$queryRaw<
      Array<{ now: Date }>
    >`SELECT clock_timestamp() AS now`;
    if (rows.length !== 1 || !row)
      throw new Error("Bootstrap storage unavailable");
    return row.now;
  }

  async status(): Promise<{ state: "required" | "complete" }> {
    await this.database.prisma.bootstrapState.findUniqueOrThrow({
      where: { id: "primary" },
      select: { id: true },
    });
    return {
      state: (await this.closed(this.database.prisma))
        ? "complete"
        : "required",
    };
  }

  private async audit(
    tx: Tx,
    action:
      | "bootstrap_token_issued"
      | "bootstrap_token_consumed"
      | "bootstrap_token_rejected"
      | "administrator_created",
    outcome: "succeeded" | "failed" = "succeeded",
  ) {
    await tx.installationAuditEvent.create({
      data: {
        installationId: "primary",
        actorType: "server",
        action,
        outcome,
        requestId: randomUUID(),
      },
    });
  }

  async issue(): Promise<void> {
    await prepareTokenDirectory();
    await this.database.prisma.$transaction(
      async (tx) => {
        const now = await this.lock(tx);
        if (await this.closed(tx))
          throw new Error("Administrator is already initialized");
        const workspace = await tx.workspace.findUniqueOrThrow({
          where: {
            name: process.env.TOWNBASE_DEFAULT_WORKSPACE_NAME ?? "townbase",
          },
          select: { id: true, name: true },
        });
        const installation = await tx.installation.findUnique({
          where: { id: "primary" },
        });
        if (!installation) {
          await tx.installation.create({
            data: {
              workspaceId: workspace.id,
              name: workspace.name,
              timeZone: "UTC",
            },
          });
          await tx.installationAuditEvent.create({
            data: {
              installationId: "primary",
              actorType: "server",
              action: "installation_created",
              outcome: "succeeded",
              requestId: randomUUID(),
            },
          });
        } else if (installation.workspaceId !== workspace.id)
          throw new Error("Installation workspace mismatch");
        const token = randomBytes(32).toString("base64url");
        await tx.bootstrapState.update({
          where: { id: "primary" },
          data: {
            tokenHash: digest(token),
            issuedAt: now,
            expiresAt: new Date(now.getTime() + 3600000),
            consumedAt: null,
            failedAttempts: 0,
            attemptWindowStart: null,
            blockedUntil: null,
          },
        });
        await this.audit(tx, "bootstrap_token_issued");
        await writeTokenFile(token);
      },
      { timeout: 30000, maxWait: 3000 },
    );
  }

  async register(body: unknown): Promise<SetupOutcome> {
    const result = await this.database.prisma.$transaction(
      async (tx): Promise<SetupOutcome> => {
        const now = await this.lock(tx);
        if (await this.closed(tx)) return "closed";
        const state = await tx.bootstrapState.findUniqueOrThrow({
          where: { id: "primary" },
        });
        if (state.blockedUntil != null && state.blockedUntil > now)
          return "throttled";
        const validObject =
          body != null && typeof body === "object" && !Array.isArray(body);
        const input = validObject ? (body as Record<string, unknown>) : {};
        const token = typeof input.token === "string" ? input.token : "";
        const matches =
          /^[A-Za-z0-9_-]{43}$/.test(token) &&
          state.tokenHash != null &&
          timingSafeEqual(
            Buffer.from(digest(token), "hex"),
            Buffer.from(state.tokenHash, "hex"),
          );
        const username =
          typeof input.username === "string" ? input.username.trim() : "";
        const password =
          typeof input.password === "string" ? input.password : "";
        const validFields =
          Object.keys(input).sort().join(",") === "password,token,username" &&
          username.length > 0 &&
          [...username].length <= 128 &&
          !/[\p{Cc}]/u.test(username) &&
          [...password].length >= 15 &&
          [...password].length <= 128 &&
          !password.includes("\0");
        if (
          !matches ||
          state.expiresAt == null ||
          state.expiresAt <= now ||
          state.consumedAt != null ||
          !validFields
        ) {
          const inWindow =
            state.attemptWindowStart != null &&
            now.getTime() - state.attemptWindowStart.getTime() < 900000;
          const failures = inWindow ? state.failedAttempts + 1 : 1;
          await tx.bootstrapState.update({
            where: { id: "primary" },
            data: {
              failedAttempts: failures,
              attemptWindowStart: inWindow ? state.attemptWindowStart : now,
              blockedUntil:
                failures >= 10
                  ? new Date(
                      now.getTime() +
                        Math.min(60000, 1000 * 2 ** Math.min(6, failures - 10)),
                    )
                  : null,
            },
          });
          if (await tx.installation.count())
            await this.audit(tx, "bootstrap_token_rejected", "failed");
          return !matches ||
            state.expiresAt == null ||
            state.expiresAt <= now ||
            state.consumedAt != null
            ? "invalid_token"
            : "invalid_request";
        }
        const passwordHash = await hashPassword(password);
        await tx.administrator.create({
          data: { installationId: "primary", username, passwordHash },
        });
        await tx.installation.update({
          where: { id: "primary" },
          data: { initializedAt: now },
        });
        await tx.bootstrapState.update({
          where: { id: "primary" },
          data: { tokenHash: null, consumedAt: now },
        });
        await this.audit(tx, "administrator_created");
        await this.audit(tx, "bootstrap_token_consumed");
        return "registered";
      },
      { timeout: 30000, maxWait: 3000 },
    );
    if (result === "registered" || result === "closed")
      await deleteTokenFile().catch(() => this.cleanupWarning());
    return result;
  }

  async cleanup(): Promise<void> {
    await this.database.prisma.$transaction(
      async (tx) => {
        const now = await this.lock(tx);
        await deleteTemporaryTokenFiles();
        const state = await tx.bootstrapState.findUniqueOrThrow({
          where: { id: "primary" },
        });
        if (
          state.tokenHash == null ||
          state.expiresAt == null ||
          state.expiresAt <= now ||
          (await this.closed(tx))
        ) {
          if (state.tokenHash != null)
            await tx.bootstrapState.update({
              where: { id: "primary" },
              data: { tokenHash: null },
            });
          await deleteTokenFile();
        }
      },
      { timeout: 10000, maxWait: 3000 },
    );
  }
}
