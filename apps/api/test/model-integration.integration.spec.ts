import "reflect-metadata";
import { Test } from "@nestjs/testing";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Logger } from "@nestjs/common";
import { PrismaClient } from "@townbase/database";
import { randomBytes } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
  chmod,
  rm,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { DeploymentModule } from "../src/deployment/deployment.module";
import { DeploymentDatabase } from "../src/deployment/deployment-database";
import { configureSelfHostedHttp } from "../src/deployment/self-hosted-http";
import { AuthService } from "../src/auth/auth.service";
import { hashPassword } from "../src/setup/password";
import { ModelIntegrationService } from "../src/model-integration/model-integration.service";
import {
  CredentialVault,
  API_KEY_MAX_LENGTH,
  MAX_CIPHERTEXT_LENGTH,
  type CredentialPurpose,
} from "../src/model-integration/credential-vault";
import { OPENAI_ENDPOINTS } from "../src/model-integration/transfer-policy";

const integration =
  process.env.TOWNBASE_INTEGRATION_SETTINGS_TEST === "1"
    ? describe
    : describe.skip;
integration(
  "stored credential, reauthentication, scope and transfer boundaries",
  () => {
    const original = { ...process.env },
      password = "C02 synthetic safe password!";
    const key = "sk-proj-C02-secret-canary-1234567890",
      base = "/settings/model-integration";
    let owner: PrismaClient,
      runtime: DeploymentDatabase,
      app: NestExpressApplication;
    let directory: string,
      cookie: string,
      workspaceId: string,
      administratorId: string;
    beforeAll(async () => {
      const url = new URL(process.env.DATABASE_URL!);
      if (url.hostname !== "postgres" || url.pathname !== "/townbase_c02_test")
        throw new Error("Dedicated C02 test DB required");
      owner = new PrismaClient({
        datasources: { db: { url: url.toString() } },
      });
      url.username = "townbase_runtime";
      url.password = (
        await readFile(process.env.TOWNBASE_RUNTIME_PASSWORD_FILE!, "utf8")
      ).trim();
      process.env.DATABASE_URL = url.toString();
      runtime = new DeploymentDatabase();
    });
    beforeEach(async () => {
      await owner.$executeRaw`ALTER TABLE "InstallationAuditEvent" DROP CONSTRAINT IF EXISTS "C02_reject_audit"`;
      await owner.modelCredential.deleteMany();
      await owner.modelTransferPolicy.deleteMany();
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
        },
      });
      const workspace = await owner.workspace.upsert({
        where: { name: "c02-test" },
        create: { name: "c02-test" },
        update: {},
      });
      workspaceId = workspace.id;
      await owner.installation.create({
        data: {
          workspaceId,
          initializedAt: new Date(),
          name: "C02 fixture",
          timeZone: "UTC",
        },
      });
      administratorId = (
        await owner.administrator.create({
          data: {
            installationId: "primary",
            username: "admin",
            passwordHash: await hashPassword(password),
          },
        })
      ).id;
      directory = await mkdtemp(path.join(os.tmpdir(), "townbase-c02-"));
      for (const name of [
        "BOOTSTRAP",
        "RECOVERY",
        "DOCUMENTS",
        "ATTACHMENTS",
      ]) {
        process.env[`TOWNBASE_${name}_PATH`] = path.join(directory, name);
        await mkdir(process.env[`TOWNBASE_${name}_PATH`]!);
      }
      process.env.TOWNBASE_MASTER_KEY_FILE = path.join(directory, "master");
      await writeFile(
        process.env.TOWNBASE_MASTER_KEY_FILE,
        randomBytes(32).toString("base64url"),
        { mode: 0o444 },
      );
      process.env.TOWNBASE_SETUP_LOCAL_HTTP = "1";
      delete process.env.TOWNBASE_PUBLIC_ORIGIN;
      const module = await Test.createTestingModule({
        imports: [DeploymentModule],
      })
        .overrideProvider(DeploymentDatabase)
        .useValue(runtime)
        .compile();
      app = module.createNestApplication<NestExpressApplication>({
        bodyParser: false,
      });
      configureSelfHostedHttp(app);
      await app.init();
      const login = await call("post", "/auth/login")
        .send({ username: "admin", password })
        .expect(200);
      cookie = (login.headers["set-cookie"] as unknown as string[])[0]!.split(
        ";",
      )[0]!;
    });
    afterEach(async () => {
      jest.restoreAllMocks();
      await app?.close();
      if (directory != null)
        await rm(directory, { recursive: true, force: true });
    });
    afterAll(async () => {
      await owner.$executeRaw`ALTER TABLE "InstallationAuditEvent" DROP CONSTRAINT IF EXISTS "C02_reject_audit"`;
      await runtime.prisma.$disconnect();
      await owner.$disconnect();
      process.env = original;
    });
    function call(
      method: "get" | "put" | "post" | "delete",
      url: string,
      authenticated = false,
    ) {
      const req = request(app.getHttpServer())
        [method](url)
        .set("Host", "localhost:3000")
        .set("Origin", "http://localhost:3000")
        .set("X-Townbase-Auth", "1");
      return authenticated ? req.set("Cookie", cookie) : req;
    }
    function putKey(purpose: CredentialPurpose, apiKey = key) {
      return call("put", base + `/credentials/${purpose}`, true).send({
        currentPassword: password,
        apiKey,
      });
    }
    async function requester() {
      const result = await app
        .get(AuthService)
        .requester(cookie.slice(cookie.indexOf("=") + 1));
      if (!result.ok) throw new Error("Fixture requester unavailable");
      return result.requester;
    }
    it("defaults to no transfers/no answer model, and preserves the fixed embedding", async () => {
      const result = await call("get", base, true)
        .expect(200)
        .expect("Cache-Control", "no-store");
      expect(result.body.transfers).toEqual({
        documentEmbedding: false,
        rag: false,
        attachment: false,
      });
      expect(result.body.embedding).toEqual({
        model: "text-embedding-3-small",
        dimensions: 1536,
      });
      expect(result.body.answerModel).toBeNull();
      expect(result.body.capabilities.providerCalls).toBe(false);
      await expect(
        app
          .get(ModelIntegrationService)
          .assertTransfer(
            await requester(),
            "document_embedding",
            OPENAI_ENDPOINTS.embedding,
            "Safe",
          ),
      ).rejects.toThrow("transfer_not_allowed");
    });
    it.each(["answer", "embedding"] as const)(
      "%s: stores only encrypted bytes and reads masks in a separate service instance",
      async (purpose) => {
        await putKey(purpose).expect(200);
        const row = await owner.modelCredential.findUniqueOrThrow({
          where: {
            installationId_purpose: {
              installationId: "primary",
              purpose,
            },
          },
        });
        expect(JSON.stringify(row)).not.toContain(key);
        expect(row.enabled).toBe(true);
        expect(
          await app.get(CredentialVault).reveal("primary", purpose, row),
        ).toBe(key);
        const reader = new ModelIntegrationService(
          runtime,
          app.get(AuthService),
          new CredentialVault(),
        );
        const ctx = {
          installationId: "primary",
          workspaceId,
          administratorId,
          username: "admin",
          expiresAt: new Date().toISOString(),
        };
        const response = await reader.snapshot(ctx);
        expect(response.credentials[purpose]).toEqual({
          configured: true,
          enabled: true,
          masked: "********",
          connection: "not_checked",
        });
        expect(JSON.stringify(response)).not.toContain(key);
        expect(
          await owner.installationAuditEvent.findMany({
            where: { action: `${purpose}_key_updated` },
          }),
        ).toHaveLength(1);
      },
    );
    it.each(["answer", "embedding"] as const)(
      "%s: replaces with a new nonce, disables and deletes without retaining the old key",
      async (purpose) => {
        await putKey(purpose).expect(200);
        const previous = await owner.modelCredential.findFirstOrThrow();
        await putKey(purpose, key + "new").expect(200);
        const row = await owner.modelCredential.findFirstOrThrow();
        expect(row.nonce).not.toBe(previous.nonce);
        expect(row.ciphertext).not.toBe(previous.ciphertext);
        expect(
          await app.get(CredentialVault).reveal("primary", purpose, row),
        ).toBe(key + "new");
        await call("post", base + `/credentials/${purpose}/disable`, true)
          .send({ currentPassword: password })
          .expect(200);
        expect((await owner.modelCredential.findFirstOrThrow()).enabled).toBe(
          false,
        );
        await call("delete", base + `/credentials/${purpose}`, true)
          .send({ currentPassword: password })
          .expect(200);
        expect(await owner.modelCredential.count()).toBe(0);
        const audit = await owner.installationAuditEvent.findMany();
        expect(audit.map((row) => row.action)).toEqual(
          expect.arrayContaining([
            `${purpose}_key_disabled`,
            `${purpose}_key_deleted`,
          ]),
        );
        expect(JSON.stringify(audit)).not.toContain("secret-canary");
      },
    );
    it.each(["answer", "embedding"] as const)(
      "%s: requires authentication, rejects forged scope/endpoint/model/dimension fields and malformed JSON",
      async (purpose) => {
        await call("get", base).expect(401);
        await call("put", base + `/credentials/${purpose}`)
          .send({ currentPassword: password, apiKey: key })
          .expect(401);
        await call("put", base + `/credentials/${purpose}`, true)
          .send({
            currentPassword: password,
            apiKey: key,
            workspaceId: "foreign",
          })
          .expect(403);
        for (const extra of [
          { endpoint: "https://evil.test" },
          { model: "text-embedding-3-large" },
          { dimensions: 3072 },
        ])
          await call("put", base + `/credentials/${purpose}`, true)
            .send({ currentPassword: password, apiKey: key, ...extra })
            .expect(400);
        await call("put", base + "/credentials/unknown", true)
          .send({ currentPassword: password, apiKey: key })
          .expect(400);
        await call("put", base + `/credentials/${purpose}`, true)
          .set("Origin", "https://evil.test")
          .send({ currentPassword: password, apiKey: key })
          .expect(403);
        await call("put", base + `/credentials/${purpose}`, true)
          .set("Content-Type", "text/plain")
          .send("bad")
          .expect(415);
        await call("put", base + `/credentials/${purpose}`, true)
          .set("Content-Type", "application/json")
          .send('{"apiKey":')
          .expect(400);
        for (const [method, suffix] of [
          ["post", "/disable"],
          ["delete", ""],
        ] as const) {
          const endpoint = base + `/credentials/${purpose}` + suffix;
          await call(method, endpoint)
            .send({ currentPassword: password })
            .expect(401);
          await call(method, endpoint, true)
            .set("X-Workspace-Id", "foreign")
            .send({ currentPassword: password })
            .expect(403);
          await call(method, endpoint, true)
            .set("Origin", "https://evil.test")
            .send({ currentPassword: password })
            .expect(403);
          await call(method, endpoint, true).send({}).expect(400);
          await call(method, endpoint, true)
            .send({ currentPassword: "wrong synthetic password" })
            .expect(401);
        }
        expect(await owner.modelCredential.count()).toBe(0);
      },
    );
    it.each(["answer", "embedding"] as const)(
      "%s: persists failed reauthentication attempts and throttles without saving credentials",
      async (purpose) => {
        for (let i = 0; i < 10; i++)
          await call("put", base + `/credentials/${purpose}`, true)
            .send({
              currentPassword: "incorrect synthetic password",
              apiKey: key,
            })
            .expect(401);
        await putKey(purpose).expect(429);
        expect(
          (
            await owner.authenticationState.findUniqueOrThrow({
              where: { id: "primary" },
            })
          ).loginFailures,
        ).toBe(10);
        expect(await owner.modelCredential.count()).toBe(0);
      },
    );
    it.each([
      ["answer", "revoked"],
      ["answer", "expired"],
      ["embedding", "revoked"],
      ["embedding", "expired"],
    ] as const)(
      "%s rechecks a session %s after the HTTP guard",
      async (purpose, kind) => {
        const auth = app.get(AuthService),
          originalOperation = auth.sensitiveOperation.bind(auth);
        jest
          .spyOn(auth, "sensitiveOperation")
          .mockImplementationOnce(async (...args) => {
            await owner.administratorSession.updateMany({
              data:
                kind === "revoked"
                  ? { revokedAt: new Date() }
                  : {
                      createdAt: new Date(0),
                      lastSeenAt: new Date(1),
                      expiresAt: new Date(2),
                    },
            });
            return originalOperation(...args);
          });
        await putKey(purpose).expect(401);
        expect(await owner.modelCredential.count()).toBe(0);
      },
    );
    it.each(["answer", "embedding"] as const)(
      "%s: rolls back both settings and audit when absolute expiry occurs during the write",
      async (purpose) => {
        const auth = app.get(AuthService),
          operation = auth.sensitiveOperation.bind(auth);
        const vault = app.get(CredentialVault),
          seal = vault.seal.bind(vault);
        let expiresAt: Date;
        jest
          .spyOn(auth, "sensitiveOperation")
          .mockImplementationOnce(async (...args) => {
            expiresAt = new Date(Date.now() + 1500);
            await owner.administratorSession.updateMany({
              data: { expiresAt },
            });
            return operation(...args);
          });
        const sealing = jest
          .spyOn(vault, "seal")
          .mockImplementationOnce(async (...args) => {
            await new Promise((resolve) =>
              setTimeout(
                resolve,
                Math.max(0, expiresAt.getTime() - Date.now() + 100),
              ),
            );
            return seal(...args);
          });
        await putKey(purpose).expect(401);
        expect(sealing).toHaveBeenCalledTimes(1);
        expect(await owner.modelCredential.count()).toBe(0);
        expect(
          await owner.installationAuditEvent.count({
            where: { action: `${purpose}_key_updated` },
          }),
        ).toBe(0);
      },
    );
    it.each(["answer", "embedding"] as const)(
      "%s: rolls back a credential write when its audit event cannot be persisted",
      async (purpose) => {
        jest.spyOn(Logger, "error").mockImplementation();
        await owner.$executeRaw`ALTER TABLE "InstallationAuditEvent" ADD CONSTRAINT "C02_reject_audit" CHECK (action NOT IN ('embedding_key_updated', 'answer_key_updated'))`;
        await putKey(purpose).expect(503);
        expect(await owner.modelCredential.count()).toBe(0);
        expect(
          await owner.installationAuditEvent.count({
            where: { action: `${purpose}_key_updated` },
          }),
        ).toBe(0);
        expect(
          JSON.stringify((Logger.error as jest.Mock).mock.calls),
        ).not.toContain(key);
      },
    );
    it.each([
      ["answer", "disable"],
      ["answer", "delete"],
      ["embedding", "disable"],
      ["embedding", "delete"],
    ] as const)(
      "%s %s rolls back when its audit fails",
      async (purpose, operation) => {
        jest.spyOn(Logger, "error").mockImplementation();
        await putKey(purpose).expect(200);
        const before = await owner.modelCredential.findFirstOrThrow();
        await owner.$executeRaw`ALTER TABLE "InstallationAuditEvent" ADD CONSTRAINT "C02_reject_audit" CHECK (action NOT IN ('answer_key_disabled', 'embedding_key_disabled', 'answer_key_deleted', 'embedding_key_deleted'))`;
        const req =
          operation === "disable"
            ? call("post", base + `/credentials/${purpose}/disable`, true)
            : call("delete", base + `/credentials/${purpose}`, true);
        await req.send({ currentPassword: password }).expect(503);
        expect(await owner.modelCredential.findFirstOrThrow()).toEqual(before);
        expect(
          await owner.installationAuditEvent.count({
            where: {
              action: {
                in: [
                  "answer_key_disabled",
                  "embedding_key_disabled",
                  "answer_key_deleted",
                  "embedding_key_deleted",
                ],
              },
            },
          }),
        ).toBe(0);
      },
    );
    it.each(["answer", "embedding"] as const)(
      "%s: fails closed on a replaced master key and does not return cryptographic details",
      async (purpose) => {
        jest.spyOn(Logger, "error").mockImplementation();
        await putKey(purpose).expect(200);
        await chmod(process.env.TOWNBASE_MASTER_KEY_FILE!, 0o600);
        await writeFile(
          process.env.TOWNBASE_MASTER_KEY_FILE!,
          randomBytes(32).toString("base64url"),
        );
        await chmod(process.env.TOWNBASE_MASTER_KEY_FILE!, 0o444);
        const result = await call("get", base, true).expect(503);
        expect(result.body.code).toBe("integration_unavailable");
        expect(result.body.reason).toBe("credential_unavailable");
        delete process.env.TOWNBASE_MASTER_KEY_FILE;
        const missing = await call("get", base, true).expect(503);
        expect(missing.body.reason).toBe("master_key_unavailable");
        expect(JSON.stringify(result.body)).not.toContain(key);
        expect(
          JSON.stringify((Logger.error as jest.Mock).mock.calls),
        ).not.toContain(key);
      },
    );
    it("persists purpose permissions and rechecks the latest stored policy", async () => {
      await call("put", base + "/transfers", true)
        .send({
          currentPassword: password,
          documentEmbedding: true,
          rag: false,
          attachment: false,
        })
        .expect(200);
      await call("put", base + "/transfers", true)
        .send({
          currentPassword: password,
          documentEmbedding: true,
          rag: false,
          attachment: false,
        })
        .expect(200);
      expect(
        await owner.installationAuditEvent.count({
          where: { action: "model_transfer_policy_changed" },
        }),
      ).toBe(1);
      const stored = await owner.modelTransferPolicy.findUniqueOrThrow({
        where: { installationId: "primary" },
      });
      expect(stored.documentEmbedding).toBe(true);
      expect(
        (await call("get", base, true).expect(200)).body.transfers,
      ).toEqual({ documentEmbedding: true, rag: false, attachment: false });
      const settings = app.get(ModelIntegrationService),
        ctx = await requester();
      await expect(
        settings.assertTransfer(
          ctx,
          "document_embedding",
          OPENAI_ENDPOINTS.embedding,
          "Safe text",
        ),
      ).resolves.toBeUndefined();
      await expect(
        settings.assertTransfer(
          ctx,
          "rag_answer",
          OPENAI_ENDPOINTS.answer,
          "Safe text",
        ),
      ).rejects.toThrow("transfer_not_allowed");
      await expect(
        settings.assertTransfer(
          ctx,
          "document_embedding",
          OPENAI_ENDPOINTS.embedding,
          key,
        ),
      ).rejects.toThrow("sensitive_content");
      await call("put", base + "/transfers", true)
        .send({
          currentPassword: password,
          documentEmbedding: false,
          rag: false,
          attachment: false,
        })
        .expect(200);
      await expect(
        settings.assertTransfer(
          ctx,
          "document_embedding",
          OPENAI_ENDPOINTS.embedding,
          "Safe text",
        ),
      ).rejects.toThrow("transfer_not_allowed");
      expect(
        await owner.installationAuditEvent.count({
          where: { action: "model_transfer_policy_changed" },
        }),
      ).toBe(2);
    });
    it.each(["answer", "embedding"] as const)(
      "%s audit reflects only real disable/delete transitions",
      async (purpose) => {
        const disabled = `${purpose}_key_disabled` as const,
          deleted = `${purpose}_key_deleted` as const;
        for (const operation of ["disable", "delete"] as const) {
          const req =
            operation === "disable"
              ? call("post", base + `/credentials/${purpose}/disable`, true)
              : call("delete", base + `/credentials/${purpose}`, true);
          await req.send({ currentPassword: password }).expect(200);
        }
        expect(
          await owner.installationAuditEvent.count({
            where: { action: { in: [disabled, deleted] } },
          }),
        ).toBe(0);
        await putKey(purpose).expect(200);
        await call("post", base + `/credentials/${purpose}/disable`, true)
          .send({ currentPassword: password })
          .expect(200);
        const row = await owner.modelCredential.findFirstOrThrow();
        await call("post", base + `/credentials/${purpose}/disable`, true)
          .send({ currentPassword: password })
          .expect(200);
        expect(
          (await owner.modelCredential.findFirstOrThrow()).updatedAt,
        ).toEqual(row.updatedAt);
        expect(
          await owner.installationAuditEvent.count({
            where: { action: disabled },
          }),
        ).toBe(1);
        for (let i = 0; i < 2; i++)
          await call("delete", base + `/credentials/${purpose}`, true)
            .send({ currentPassword: password })
            .expect(200);
        expect(
          await owner.installationAuditEvent.count({
            where: { action: deleted },
          }),
        ).toBe(1);
      },
    );
    it.each(["answer", "embedding"] as const)(
      "%s rejects malformed passwords as 400 while persisting attempt limits",
      async (purpose) => {
        for (const currentPassword of [null, 1, "short", "x".repeat(129)]) {
          await call("put", base + `/credentials/${purpose}`, true)
            .send({ currentPassword, apiKey: key })
            .expect(400);
        }
        expect(
          (
            await owner.authenticationState.findUniqueOrThrow({
              where: { id: "primary" },
            })
          ).loginFailures,
        ).toBe(4);
        expect(await owner.modelCredential.count()).toBe(0);
      },
    );
    it("keeps the other credential intact across replacement, disable and deletion", async () => {
      await putKey("embedding", key + "embedding").expect(200);
      const embedding = await owner.modelCredential.findFirstOrThrow();
      await putKey("answer", key + "answer").expect(200);
      await putKey("answer", key + "replacement").expect(200);
      await call("post", base + "/credentials/answer/disable", true)
        .send({ currentPassword: password })
        .expect(200);
      expect(
        await owner.modelCredential.findUniqueOrThrow({
          where: {
            installationId_purpose: {
              installationId: "primary",
              purpose: "embedding",
            },
          },
        }),
      ).toEqual(embedding);
      await call("delete", base + "/credentials/embedding", true)
        .send({ currentPassword: password })
        .expect(200);
      const answer = await owner.modelCredential.findFirstOrThrow();
      expect(answer.purpose).toBe("answer");
      expect(answer.enabled).toBe(false);
      expect(
        await app.get(CredentialVault).reveal("primary", "answer", answer),
      ).toBe(key + "replacement");
      const state = (await call("get", base, true).expect(200)).body;
      expect(state.credentials.answer.configured).toBe(true);
      expect(state.credentials.embedding.configured).toBe(false);
    });
    it("enforces encryption format, lengths and installation invariants in SQL", async () => {
      await putKey("embedding", "a".repeat(API_KEY_MAX_LENGTH)).expect(200);
      expect(
        (await owner.modelCredential.findFirstOrThrow()).ciphertext,
      ).toHaveLength(MAX_CIPHERTEXT_LENGTH);
      await owner.modelCredential.deleteMany();
      const sealed = await app
        .get(CredentialVault)
        .seal("primary", "embedding", key);
      for (const bad of [
        { formatVersion: 2 },
        { nonce: "!".repeat(16) },
        { tag: "x" },
        { ciphertext: "x".repeat(MAX_CIPHERTEXT_LENGTH + 1) },
        { installationId: "foreign" },
      ]) {
        await expect(
          owner.modelCredential.create({
            data: {
              ...sealed,
              installationId: "primary",
              purpose: "embedding",
              ...bad,
            },
          }),
        ).rejects.toThrow();
      }
      expect(await owner.modelCredential.count()).toBe(0);
    });
    it("keeps identity columns and unrelated tables inaccessible to the runtime role", async () => {
      await putKey("embedding").expect(200);
      for (const column of ["installationId", "purpose", "createdAt"]) {
        const [grants] = await owner.$queryRaw<
          Array<{ allowed: boolean }>
        >`SELECT has_column_privilege('townbase_runtime', '"ModelCredential"', ${column}, 'UPDATE') AS allowed`;
        expect(grants?.allowed).toBe(false);
      }
      for (const column of ["installationId"]) {
        const [grants] = await owner.$queryRaw<
          Array<{ allowed: boolean }>
        >`SELECT has_column_privilege('townbase_runtime', '"ModelTransferPolicy"', ${column}, 'UPDATE') AS allowed`;
        expect(grants?.allowed).toBe(false);
      }
      await expect(
        runtime.prisma.$executeRaw`DELETE FROM "InstallationAuditEvent"`,
      ).rejects.toThrow();
      await expect(
        runtime.prisma.$executeRaw`DELETE FROM "ModelTransferPolicy"`,
      ).rejects.toThrow();
      await expect(
        runtime.prisma
          .$executeRaw`UPDATE "ModelCredential" SET "installationId" = 'foreign'`,
      ).rejects.toThrow();
      await expect(runtime.prisma.document.findMany()).rejects.toThrow();
    });
  },
);
