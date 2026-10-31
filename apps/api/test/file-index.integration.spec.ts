import "reflect-metadata";
import { assertFreshFileManagementDatabase } from "./file-management-fixture";
import { randomBytes, createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import {
  mkdtemp,
  mkdir,
  realpath,
  rm,
  readFile,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PrismaClient } from "@townbase/database";
import { Test } from "@nestjs/testing";
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import type { AdministratorContext } from "../src/auth/auth.service";
const built = createRequire(__filename);
const { FileRunService } = built(
  "../dist/files/file-run.service",
) as typeof import("../src/files/file-run.service");
const { FilesModule } = built(
  "../dist/files/files.module",
) as typeof import("../src/files/files.module");
import { hashPassword } from "../src/setup/password";
const { configureSelfHostedHttp } = built(
  "../dist/deployment/self-hosted-http",
) as typeof import("../src/deployment/self-hosted-http");

const { chunkRequestId } = built(
  "../dist/files/file-chunker",
) as typeof import("../src/files/file-chunker");
const { FileIndexService } = built(
  "../dist/files/file-index.service",
) as typeof import("../src/files/file-index.service");
const { OpenAIProvider } = built(
  "../dist/model-integration/openai-provider",
) as typeof import("../src/model-integration/openai-provider");
const { CredentialVault } = built(
  "../dist/model-integration/credential-vault",
) as typeof import("../src/model-integration/credential-vault");
const { ModelCallError, PRICE_VERSION } = built(
  "../dist/model-integration/model-policy",
) as typeof import("../src/model-integration/model-policy");
const { pdf, docx } = built(
  "./file-fixtures",
) as typeof import("./file-fixtures");
const unitVector = (axis = 0) =>
  Array.from({ length: 1536 }, (_, i) => (i === axis ? 1 : 0));
const provider = { call: jest.fn() };
const integration =
  process.env.TOWNBASE_FILE_INDEX_TEST === "1" ? describe : describe.skip;
integration("D04 actual persistent run queue", () => {
  jest.setTimeout(60000);
  let owner: PrismaClient,
    app: NestExpressApplication,
    directory: string,
    token: string,
    context: AdministratorContext;
  const environment = { ...process.env };
  const headers = () => ({
    Host: "127.0.0.1:3000",
    Origin: "http://127.0.0.1:3000",
    "X-Townbase-Auth": "1",
    "X-Townbase-Request-Id": randomUUID(),
    Cookie: `townbase_session=${token}`,
  });
  const payload = (name: string, bytes: Buffer) => ({
    name,
    contentBase64: bytes.toString("base64"),
  });
  async function settled(ack: { runId: string }) {
    for (let i = 0; i < 400; i++) {
      const row = await owner.fileRun.findUniqueOrThrow({
        where: { id: ack.runId },
      });
      if (!["queued", "running"].includes(row.status)) {
        // A terminal DB result precedes pending-input cleanup. Wait for the
        // current local pump too, rather than racing its separate lock 5.
        await (runs as unknown as { task?: Promise<void> }).task;
        for (let j = 0; j < 200; j++) {
          const free = await owner.$transaction(
            async (tx) =>
              (
                await tx.$queryRaw<
                  Array<{ free: boolean }>
                >`SELECT pg_try_advisory_xact_lock(741126,3) AS free`
              )[0]!.free,
          );
          if (free) return row;
          await new Promise((r) => setTimeout(r, 10));
        }
      }
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error("Run did not settle");
  }
  async function accepted(
    method: "post" | "put",
    url: string,
    name: string,
    bytes: Buffer,
  ) {
    const response = await request(app.getHttpServer())
      [method](url)
      .set(headers())
      .send(payload(name, bytes))
      .expect(202);
    const row = await settled(response.body);
    if (!row.resultOriginalId)
      throw new Error("No persisted file result: " + row.errorCode);
    return (
      await request(app.getHttpServer())
        .get(`/files/${row.resultOriginalId}`)
        .set(headers())
        .expect(200)
    ).body;
  }
  async function register(
    name = "a.txt",
    bytes: Buffer = Buffer.from("한국어 original"),
  ) {
    return accepted("post", "/files", name, bytes);
  }
  let runs: InstanceType<typeof FileRunService>;
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    if (url.hostname !== "postgres" || url.pathname !== "/townbase_d04_test")
      throw new Error("Dedicated D04 DB required");
    owner = new PrismaClient({ datasources: { db: { url: url.toString() } } });
    await assertFreshFileManagementDatabase(owner);
    const workspace = await owner.workspace.create({
      data: { name: "D04 synthetic fixture" },
    });
    await owner.installation.create({
      data: {
        id: "primary",
        workspaceId: workspace.id,
        name: "D04 synthetic",
        timeZone: "UTC",
        initializedAt: new Date(),
      },
    });
    const administrator = await owner.administrator.create({
      data: {
        installationId: "primary",
        username: "d02-admin",
        passwordHash: await hashPassword("D04 synthetic fixture password!"),
      },
    });
    token = randomBytes(32).toString("base64url");
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + 3600_000);
    await owner.administratorSession.create({
      data: {
        tokenHash: createHash("sha256").update(token).digest("hex"),
        installationId: "primary",
        administratorId: administrator.id,
        expiresAt,
        createdAt,
        lastSeenAt: createdAt,
      },
    });
    context = {
      installationId: "primary",
      workspaceId: workspace.id,
      administratorId: administrator.id,
      username: administrator.username,
      expiresAt: expiresAt.toISOString(),
    };
    directory = await realpath(
      await mkdtemp(path.join(tmpdir(), "townbase-d04-db-")),
    );
    process.env.TOWNBASE_DOCUMENTS_PATH = path.join(directory, "documents");
    process.env.TOWNBASE_RECOVERY_PATH = path.join(directory, "recovery");
    await mkdir(process.env.TOWNBASE_DOCUMENTS_PATH, { mode: 0o700 });
    process.env.TOWNBASE_SETUP_LOCAL_HTTP = "1";
    delete process.env.TOWNBASE_PUBLIC_ORIGIN;
    url.username = "townbase_runtime";
    url.password = (
      await readFile(process.env.TOWNBASE_RUNTIME_PASSWORD_FILE!, "utf8")
    ).trim();
    process.env.DATABASE_URL = url.toString();
    process.env.TOWNBASE_MASTER_KEY_FILE = path.join(directory, "master");
    await writeFile(
      process.env.TOWNBASE_MASTER_KEY_FILE,
      randomBytes(32).toString("base64url"),
      { mode: 0o444 },
    );
    const module = await Test.createTestingModule({
      imports: [FilesModule],
    })
      .overrideProvider(OpenAIProvider)
      .useValue(provider)
      .compile();
    app = module.createNestApplication<NestExpressApplication>({
      bodyParser: false,
    });
    configureSelfHostedHttp(app);
    await app.init();
    runs = app.get(FileRunService);
    await owner.modelCredential.create({
      data: {
        installationId: "primary",
        purpose: "embedding",
        ...(await app
          .get(CredentialVault)
          .seal(
            "primary",
            "embedding",
            "sk-synthetic-D04-never-sent-1234567890",
          )),
      },
    });
    await owner.modelTransferPolicy.create({
      data: { installationId: "primary", documentEmbedding: true },
    });
    await owner.modelExecutionSettings.create({
      data: {
        installationId: "primary",
        monthlyBudgetNanoUsd: 20000000000n,
        priceVersion: PRICE_VERSION,
      },
    });
    jest
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(
        new Error("Unexpected real network in D04 synthetic suite"),
      );
  }, 30000);
  afterAll(async () => {
    jest.restoreAllMocks();
    await app?.close();
    await owner?.$disconnect();
    if (directory) await rm(directory, { recursive: true, force: true });
    process.env = environment;
  });

  beforeEach(async () => {
    provider.call.mockReset();
    provider.call.mockImplementation(
      async (_key: string, input: { input: string }) => ({
        usage: {
          input: 10,
          cached: 0,
          write30: 0,
          write12: 0,
          output: 0,
          reasoning: 0,
        },
        providerId: null,
        outcome: "succeeded",
        embedding: unitVector(input.input.includes("alpha") ? 0 : 1),
      }),
    );
    await owner.modelTransferPolicy.update({
      where: { installationId: "primary" },
      data: { documentEmbedding: true },
    });
    await owner.modelCredential.update({
      where: {
        installationId_purpose: {
          installationId: "primary",
          purpose: "embedding",
        },
      },
      data: { enabled: true },
    });
    await owner.modelExecutionSettings.update({
      where: { installationId: "primary" },
      data: {
        monthlyBudgetNanoUsd: 20000000000n,
        priceVersion: PRICE_VERSION,
        inputTokenLimit: 16000,
      },
    });
  });
  async function index(id: string, requestId: string = randomUUID()) {
    return (
      await request(app.getHttpServer())
        .post(`/files/${id}/index`)
        .set({ ...headers(), "X-Townbase-Request-Id": requestId })
        .send({})
        .expect(202)
    ).body as { runId: string; status: string; existing: boolean };
  }
  async function read(id: string) {
    return (
      await request(app.getHttpServer())
        .get(`/files/${id}`)
        .set(headers())
        .expect(200)
    ).body;
  }
  const search = (v = unitVector(0)) =>
    app.get(FileIndexService).search(token, context, v, 20);
  test.each(["txt", "md", "pdf", "docx"])(
    "%s persists a fixed vector with original positions and survives a separate authenticated read",
    async (format) => {
      const bytes =
        format === "pdf"
          ? pdf()
          : format === "docx"
            ? docx()
            : Buffer.from(
                format === "md" ? "# Heading\nalpha source" : "alpha source",
              );
      const item = await register(`source.${format}`, bytes);
      expect(item.version.searchable).toBe(false);
      const run = await settled(await index(item.id));
      expect(run).toMatchObject({
        status: "succeeded",
        operation: "index",
        configurationVersion: "file-index-d04-v2",
        resultVersionId: item.version.id,
      });
      const file = await read(item.id);
      expect(file.version).toMatchObject({
        searchable: true,
        indexStatus: "indexed",
      });
      expect(file.version.chunkCount).toBeGreaterThan(0);
      const rows = await owner.$queryRaw<
        Array<{ dimensions: number; model: string }>
      >`SELECT vector_dims(ch.embedding) AS dimensions,i."embeddingModel" AS model FROM "FileIndexChunk" ch JOIN "FileIndex" i ON i.id=ch."indexId" WHERE i."versionId"=${item.version.id}::uuid`;
      expect(rows.length).toBe(file.version.chunkCount);
      expect(
        rows.every(
          (r) => r.dimensions === 1536 && r.model === "text-embedding-3-small",
        ),
      ).toBe(true);
      const match = (await search()).find((r) => r.originalId === item.id);
      expect(match).toMatchObject({
        sourceType: "uploaded_file",
        reference: `/files/${item.id}/reference`,
        knowledgeTypes: ["unknown"],
        domainTags: [],
        status: "active",
        sourcePriority: 50,
        requestedMode: null,
        resolvedMode: null,
      });
      expect(Array.isArray(match?.locations)).toBe(true);
    },
  );
  test("same request UUID replays and unchanged indexing never calls the provider again", async () => {
    const item = await register(
        "unchanged.txt",
        Buffer.from("alpha unchanged"),
      ),
      id = randomUUID();
    const first = await index(item.id, id);
    expect((await settled(first)).status).toBe("succeeded");
    const count = provider.call.mock.calls.length;
    expect(await index(item.id, id.toUpperCase())).toMatchObject({
      runId: first.runId,
      existing: true,
    });
    const repeat = await settled(await index(item.id));
    expect(repeat).toMatchObject({ status: "succeeded", unchangedCount: 1 });
    expect(provider.call).toHaveBeenCalledTimes(count);
    expect(
      await owner.fileIndex.count({ where: { originalId: item.id } }),
    ).toBe(1);
  });
  test.each([false, true])(
    "a lower chunk bound rebuilds rather than reusing vectors (replacement=%s)",
    async (replacement) => {
      const bytes = Buffer.from("alpha ".repeat(500));
      const item = await register("bound-change.txt", bytes);
      await settled(await index(item.id));
      const before = provider.call.mock.calls.length;
      let versionId = item.version.id;
      if (replacement)
        versionId = (
          await accepted("put", `/files/${item.id}`, "bound-change.txt", bytes)
        ).version.id;
      await owner.modelExecutionSettings.update({
        where: { installationId: "primary" },
        data: { inputTokenLimit: 512 },
      });
      expect(await settled(await index(item.id))).toMatchObject({
        status: "succeeded",
        unchangedCount: 0,
      });
      expect(provider.call.mock.calls.length).toBeGreaterThan(before);
      const saved = await owner.fileIndex.findUniqueOrThrow({
        where: {
          installationId_versionId: { installationId: "primary", versionId },
        },
      });
      expect(saved.chunkBytes).toBe(256);
      const chunks = await owner.fileIndexChunk.findMany({
        where: { indexId: saved.id },
      });
      expect(chunks.every((c) => Buffer.byteLength(c.content) <= 256)).toBe(
        true,
      );
      const count = provider.call.mock.calls.length;
      expect(await settled(await index(item.id))).toMatchObject({
        status: "succeeded",
        unchangedCount: 1,
      });
      expect(provider.call).toHaveBeenCalledTimes(count);
      // Large fixture produces many equally ranked chunks. Delete this test's
      // original through the product API so it cannot crowd later topK checks.
      await request(app.getHttpServer())
        .delete(`/files/${item.id}`)
        .set(headers())
        .send({})
        .expect(200);
    },
  );
  test("extraction order survives identical completion timestamps and opposite UUID order", async () => {
    const item = await register("ordinal.txt");
    const initial = await owner.fileExtractionRun.findFirstOrThrow({
      where: { versionId: item.version.id },
    });
    // Same millisecond, but the failed UUID sorts higher than the later success.
    await owner.fileExtractionRun.create({
      data: {
        id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        installationId: "primary",
        versionId: item.version.id,
        ordinal: 2,
        status: "failed",
        errorCode: "parser_failed",
        startedAt: initial.startedAt,
        completedAt: initial.completedAt,
      },
    });
    expect((await read(item.id)).version.runs[0].status).toBe("failed");
    expect((await settled(await index(item.id))).errorCode).toBe(
      "source_not_extracted",
    );
    await owner.fileExtractionRun.create({
      data: {
        id: "00000000-0000-4000-8000-000000000001",
        installationId: "primary",
        versionId: item.version.id,
        ordinal: 3,
        status: "extracted",
        startedAt: initial.startedAt,
        completedAt: initial.completedAt,
      },
    });
    expect((await read(item.id)).version.runs[0].ordinal).toBe(3);
    expect((await settled(await index(item.id))).status).toBe("succeeded");
    expect((await search()).some((r) => r.originalId === item.id)).toBe(true);
    // A later failure must hide the index even when completion timestamps still tie.
    await owner.fileExtractionRun.create({
      data: {
        id: randomUUID(),
        installationId: "primary",
        versionId: item.version.id,
        ordinal: 4,
        status: "failed",
        errorCode: "parser_failed",
        startedAt: initial.startedAt,
        completedAt: initial.completedAt,
      },
    });
    expect((await read(item.id)).version.searchable).toBe(false);
    expect((await search()).some((r) => r.originalId === item.id)).toBe(false);
  });
  test("aborting a dispatched provider records cancellation with its reservation held", async () => {
    const item = await register("abort-error.txt");
    let enter!: () => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    provider.call.mockImplementationOnce(
      async (_key, _input, signal: AbortSignal) => {
        enter();
        await new Promise<void>((_resolve, reject) => {
          const abort = () => reject(new DOMException("Aborted", "AbortError"));
          if (signal.aborted) abort();
          else signal.addEventListener("abort", abort, { once: true });
        });
      },
    );
    const ack = await index(item.id);
    await entered;
    await request(app.getHttpServer())
      .post(`/file-runs/${ack.runId}/stop`)
      .set(headers())
      .send({})
      .expect(200);
    expect((await settled(ack)).status).toBe("interrupted");
    const call = await owner.modelCall.findUniqueOrThrow({
      where: {
        installationId_requestId: {
          installationId: "primary",
          requestId: chunkRequestId(ack.runId, 0),
        },
      },
    });
    expect(call).toMatchObject({
      status: "unknown",
      chargedNanoUsd: null,
      errorCode: "call_cancelled",
    });
    expect(call.reservedNanoUsd).toBeGreaterThan(0n);
    expect((await read(item.id)).version.searchable).toBe(false);
  });
  test("same-content replacement rebinds vectors without merging distinct originals", async () => {
    const bytes = Buffer.from("alpha exact same version"),
      item = await register("same.txt", bytes);
    await settled(await index(item.id));
    const count = provider.call.mock.calls.length;
    const replaced = await accepted(
      "put",
      `/files/${item.id}`,
      "same.txt",
      bytes,
    );
    expect(replaced.version.searchable).toBe(false);
    expect(await settled(await index(item.id))).toMatchObject({
      status: "succeeded",
      unchangedCount: 1,
      resultVersionId: replaced.version.id,
    });
    expect(provider.call).toHaveBeenCalledTimes(count);
    const separate = await register("same.txt", bytes);
    await settled(await index(separate.id));
    expect(provider.call.mock.calls.length).toBeGreaterThan(count);
    expect((await search()).some((r) => r.versionId === item.version.id)).toBe(
      false,
    );
  });
  test.each(["transfer", "budget", "credential", "price"])(
    "%s blocks before provider I/O without publishing any chunks",
    async (condition) => {
      const item = await register(`${condition}.txt`);
      if (condition === "transfer")
        await owner.modelTransferPolicy.update({
          where: { installationId: "primary" },
          data: { documentEmbedding: false },
        });
      if (condition === "budget")
        await owner.modelExecutionSettings.update({
          where: { installationId: "primary" },
          data: { monthlyBudgetNanoUsd: null },
        });
      if (condition === "credential")
        await owner.modelCredential.update({
          where: {
            installationId_purpose: {
              installationId: "primary",
              purpose: "embedding",
            },
          },
          data: { enabled: false },
        });
      if (condition === "price")
        await owner.modelExecutionSettings.update({
          where: { installationId: "primary" },
          data: { priceVersion: null },
        });
      const result = await settled(await index(item.id));
      expect(result.status).toBe("failed");
      expect(result.errorCode).toBe(
        {
          transfer: "transfer_not_allowed",
          budget: "budget_not_configured",
          credential: "credential_not_enabled",
          price: "price_not_confirmed",
        }[condition],
      );
      expect(provider.call).not.toHaveBeenCalled();
      expect((await read(item.id)).version.searchable).toBe(false);
    },
  );
  test("provider failure after an earlier charged chunk publishes no partial index; explicit retry uses new call IDs", async () => {
    const item = await register(
      "partial.txt",
      Buffer.from("alpha ".repeat(1500)),
    );
    const success = provider.call.getMockImplementation()!;
    provider.call
      .mockImplementationOnce(success)
      .mockRejectedValueOnce(new ModelCallError("provider_unavailable", 502));
    const first = await index(item.id),
      failed = await settled(first);
    expect(failed).toMatchObject({
      status: "failed",
      errorCode: "provider_unavailable",
    });
    expect(provider.call).toHaveBeenCalledTimes(2);
    expect(
      await owner.fileIndex.count({ where: { versionId: item.version.id } }),
    ).toBe(0);
    expect((await read(item.id)).version.searchable).toBe(false);
    const unknown = await owner.modelCall.findUniqueOrThrow({
      where: {
        installationId_requestId: {
          installationId: context.installationId,
          requestId: chunkRequestId(first.runId, 1),
        },
      },
    });
    expect(unknown).toMatchObject({
      status: "unknown",
      chargedNanoUsd: null,
      errorCode: "provider_unavailable",
    });
    expect(unknown.reservedNanoUsd).toBeGreaterThan(0n);
    const charged = await owner.modelCall.findUniqueOrThrow({
      where: {
        installationId_requestId: {
          installationId: context.installationId,
          requestId: chunkRequestId(first.runId, 0),
        },
      },
    });
    expect(charged.status).toBe("succeeded");
    expect(charged.chargedNanoUsd).toBeGreaterThan(0n);
    const replay = await request(app.getHttpServer())
      .get(`/file-runs/${first.runId}`)
      .set(headers())
      .expect(200);
    expect(replay.body.status).toBe("failed");
    expect(provider.call).toHaveBeenCalledTimes(2);
    const retry = await request(app.getHttpServer())
      .post(`/file-runs/${first.runId}/retry`)
      .set(headers())
      .send({})
      .expect(202);
    expect(await settled(retry.body)).toMatchObject({
      status: "succeeded",
      retryOfId: first.runId,
    });
    expect((await read(item.id)).version.searchable).toBe(true);
  });
  test.each(["embedding_dimension_mismatch", "provider_transport_failed"])(
    "%s keeps the reservation and never writes a fake vector",
    async (code) => {
      const item = await register("provider-error.txt");
      provider.call.mockRejectedValueOnce(new ModelCallError(code, 502));
      expect(await settled(await index(item.id))).toMatchObject({
        status: "failed",
        errorCode: code,
      });
      expect(
        await owner.fileIndex.count({ where: { versionId: item.version.id } }),
      ).toBe(0);
    },
  );
  test("a failed replacement excludes the old version from search", async () => {
    const item = await register("old.txt", Buffer.from("alpha old source"));
    await settled(await index(item.id));
    expect((await search()).some((r) => r.originalId === item.id)).toBe(true);
    await accepted(
      "put",
      `/files/${item.id}`,
      "failed.pdf",
      Buffer.from("invalid pdf"),
    );
    expect((await read(item.id)).version.searchable).toBe(false);
    expect((await search()).some((r) => r.originalId === item.id)).toBe(false);
    expect((await settled(await index(item.id))).errorCode).toBe(
      "source_not_extracted",
    );
  });
  test("deletion immediately excludes indexed content and cannot be undone by an index request", async () => {
    const item = await register(
      "delete-index.txt",
      Buffer.from("alpha to delete"),
    );
    await settled(await index(item.id));
    await request(app.getHttpServer())
      .delete(`/files/${item.id}`)
      .set(headers())
      .send({})
      .expect(200);
    expect((await search()).some((r) => r.originalId === item.id)).toBe(false);
    await request(app.getHttpServer())
      .post(`/files/${item.id}/index`)
      .set(headers())
      .send({})
      .expect(404);
  });
  test("stopping a dispatched embedding blocks publication even if the provider completes late", async () => {
    const item = await register("stop-index.txt");
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>((r) => {
        enter = r;
      }),
      gate = new Promise<void>((r) => {
        release = r;
      });
    const success = provider.call.getMockImplementation()!;
    provider.call.mockImplementationOnce(async (...args) => {
      enter();
      await gate;
      return success(...args);
    });
    const ack = await index(item.id);
    try {
      await entered;
      await request(app.getHttpServer())
        .post(`/file-runs/${ack.runId}/stop`)
        .set(headers())
        .send({})
        .expect(200);
    } finally {
      release();
    }
    expect((await settled(ack)).status).toBe("interrupted");
    expect(
      await owner.fileIndex.count({ where: { versionId: item.version.id } }),
    ).toBe(0);
  });
  test("stop during master preparation is rechecked before any paid reservation or dispatch", async () => {
    const item = await register("stop-before-dispatch.txt"),
      vault = app.get(CredentialVault),
      prepare = vault.prepareReader.bind(vault);
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>((r) => {
        enter = r;
      }),
      gate = new Promise<void>((r) => {
        release = r;
      });
    const spy = jest
      .spyOn(vault, "prepareReader")
      .mockImplementationOnce(async () => {
        const reader = await prepare();
        enter();
        await gate;
        return reader;
      });
    const before = await owner.modelCall.count(),
      ack = await index(item.id);
    try {
      await entered;
      await request(app.getHttpServer())
        .post(`/file-runs/${ack.runId}/stop`)
        .set(headers())
        .send({})
        .expect(200);
    } finally {
      release();
      spy.mockRestore();
    }
    expect((await settled(ack)).status).toBe("interrupted");
    expect(provider.call).not.toHaveBeenCalled();
    expect(await owner.modelCall.count()).toBe(before);
  });
  test("failed publication rolls back all chunks while retaining the paid call record", async () => {
    const item = await register("rollback-index.txt");
    const internal = runs as unknown as {
      complete: (...args: unknown[]) => Promise<void>;
    };
    const spy = jest
      .spyOn(internal, "complete")
      .mockRejectedValueOnce(new Error("synthetic completion rollback"));
    try {
      expect((await settled(await index(item.id))).status).toBe("failed");
    } finally {
      spy.mockRestore();
    }
    expect(provider.call).toHaveBeenCalledTimes(1);
    expect(
      await owner.fileIndex.count({ where: { versionId: item.version.id } }),
    ).toBe(0);
    expect((await read(item.id)).version.searchable).toBe(false);
  });
  test("source and run boundaries protect even internal retrieval; HTTP validates index body/request ID", async () => {
    const item = await register();
    await request(app.getHttpServer())
      .post(`/files/${item.id}/index`)
      .set({ ...headers(), Cookie: "" })
      .send({})
      .expect(401);
    await request(app.getHttpServer())
      .post(`/files/${item.id}/index`)
      .set({ ...headers(), "X-Workspace-Id": "foreign" })
      .send({})
      .expect(403);
    await request(app.getHttpServer())
      .post(`/files/${item.id}/index`)
      .set(headers())
      .send({ unexpected: true })
      .expect(400);
    await request(app.getHttpServer())
      .post(`/files/${item.id}/index`)
      .set({ ...headers(), "X-Townbase-Request-Id": "" })
      .send({})
      .expect(400);
    await expect(
      app
        .get(FileIndexService)
        .search(token, { ...context, workspaceId: "foreign" }, unitVector()),
    ).rejects.toThrow();
    await expect(
      app.get(FileIndexService).search(token, context, Array(1535).fill(1)),
    ).rejects.toThrow();
    expect(provider.call).not.toHaveBeenCalled();
  });
  test("policy changed during master preparation is rechecked before dispatch", async () => {
    const item = await register("policy-race.txt"),
      vault = app.get(CredentialVault),
      prepare = vault.prepareReader.bind(vault);
    const spy = jest
      .spyOn(vault, "prepareReader")
      .mockImplementationOnce(async () => {
        const reader = await prepare();
        await owner.modelTransferPolicy.update({
          where: { installationId: "primary" },
          data: { documentEmbedding: false },
        });
        return reader;
      });
    const before = await owner.modelCall.count();
    try {
      expect(await settled(await index(item.id))).toMatchObject({
        status: "failed",
        errorCode: "transfer_not_allowed",
      });
    } finally {
      spy.mockRestore();
    }
    expect(provider.call).not.toHaveBeenCalled();
    expect(await owner.modelCall.count()).toBe(before);
  });
  test("logout during provider I/O retains cost but blocks publishing results", async () => {
    const item = await register("logout-race.txt"),
      success = provider.call.getMockImplementation()!;
    provider.call.mockImplementationOnce(async (...args) => {
      await owner.administratorSession.update({
        where: { tokenHash: createHash("sha256").update(token).digest("hex") },
        data: { revokedAt: new Date() },
      });
      return success(...args);
    });
    const ack = await index(item.id);
    try {
      expect(await settled(ack)).toMatchObject({
        status: "failed",
        errorCode: "authorization_expired",
      });
      expect(
        await owner.fileIndex.count({ where: { versionId: item.version.id } }),
      ).toBe(0);
    } finally {
      token = randomBytes(32).toString("base64url");
      const now = new Date(),
        expires = new Date(now.getTime() + 3600000);
      await owner.administratorSession.create({
        data: {
          tokenHash: createHash("sha256").update(token).digest("hex"),
          installationId: context.installationId,
          administratorId: context.administratorId,
          createdAt: now,
          lastSeenAt: now,
          expiresAt: expires,
        },
      });
      context = { ...context, expiresAt: expires.toISOString() };
    }
    expect(provider.call).toHaveBeenCalledTimes(1);
  });
  test("metadata and ranking survive storage, and archived versions never participate", async () => {
    const item = await register(
      "metadata.txt",
      Buffer.from("alpha metadata document"),
    );
    await owner.fileVersion.update({
      where: { id: item.version.id },
      data: { knowledgeTypes: ["architecture"], domainTags: ["payments"] },
    });
    await settled(await index(item.id));
    expect(
      (await search()).find((r) => r.originalId === item.id),
    ).toMatchObject({
      title: "metadata.txt",
      fileName: "metadata.txt",
      format: "txt",
      knowledgeTypes: ["architecture"],
      domainTags: ["payments"],
      score: 1,
    });
    await owner.fileVersion.update({
      where: { id: item.version.id },
      data: { documentStatus: "archived" },
    });
    expect((await search()).some((r) => r.originalId === item.id)).toBe(false);
    expect((await read(item.id)).version.searchable).toBe(false);
  });
  test("the whole extracted document is inspected before chunks can split a secret pattern", async () => {
    const item = await register("cross-boundary.txt"),
      text = "a".repeat(4090) + " sk-" + "x".repeat(32);
    await owner.fileVersion.update({
      where: { id: item.version.id },
      data: {
        extraction: {
          format: "txt",
          codePoints: text.length,
          segments: [
            { text, headingPath: [], location: { lineStart: 1, lineEnd: 1 } },
          ],
        },
      },
    });
    expect(await settled(await index(item.id))).toMatchObject({
      status: "failed",
      errorCode: "sensitive_file",
    });
    expect(provider.call).not.toHaveBeenCalled();
    expect(
      await owner.fileIndex.count({ where: { versionId: item.version.id } }),
    ).toBe(0);
  });
  test("unknown earlier spending counts against the budget before a new embedding", async () => {
    const item = await register("held-budget.txt"),
      id = randomUUID(),
      now = new Date();
    await owner.modelCall.create({
      data: {
        installationId: "primary",
        requestId: id,
        ownerAdministratorId: context.administratorId,
        purpose: "document_embedding",
        model: "text-embedding-3-small",
        credentialTag: "a".repeat(22),
        inputDigest: "a".repeat(64),
        configurationDigest: "b".repeat(64),
        priceVersion: PRICE_VERSION,
        reservedNanoUsd: 20000000n,
        status: "unknown",
        errorCode: "provider_transport_failed",
        createdAt: now,
        completedAt: now,
        deadlineAt: new Date(now.getTime() + 90000),
      },
    });
    await owner.modelExecutionSettings.update({
      where: { installationId: "primary" },
      data: { monthlyBudgetNanoUsd: 10000000n },
    });
    try {
      expect(await settled(await index(item.id))).toMatchObject({
        status: "failed",
        errorCode: "budget_exceeded",
      });
    } finally {
      await owner.modelCall.delete({
        where: {
          installationId_requestId: {
            installationId: "primary",
            requestId: id,
          },
        },
      });
    }
    expect(provider.call).not.toHaveBeenCalled();
  });
  test("changed reprocessing invalidates old vectors until a complete fresh index is published", async () => {
    const { FileExtractor } = built(
      "../dist/files/file-extractor",
    ) as typeof import("../src/files/file-extractor");
    const item = await register(
      "stale.txt",
      Buffer.from("alpha old extraction"),
    );
    await settled(await index(item.id));
    const text = "beta changed extraction",
      spy = jest
        .spyOn(app.get(FileExtractor), "extract")
        .mockResolvedValueOnce({
          format: "txt",
          codePoints: text.length,
          segments: [
            { text, headingPath: [], location: { lineStart: 1, lineEnd: 1 } },
          ],
        });
    try {
      const ack = await request(app.getHttpServer())
        .post(`/files/${item.id}/reprocess`)
        .set(headers())
        .send({})
        .expect(202);
      expect((await settled(ack.body)).status).toBe("succeeded");
      expect((await read(item.id)).version.runs[0].ordinal).toBe(2);
      const history = await owner.fileExtractionRun.findMany({
        where: { versionId: item.version.id },
        orderBy: { ordinal: "asc" },
      });
      expect(history.map((r) => r.ordinal)).toEqual([1, 2]);
    } finally {
      spy.mockRestore();
    }
    expect((await read(item.id)).version).toMatchObject({
      id: item.version.id,
      searchable: false,
      indexStatus: "stale",
    });
    expect((await search()).some((r) => r.originalId === item.id)).toBe(false);
    expect((await settled(await index(item.id))).status).toBe("succeeded");
    expect(
      (await search(unitVector(1))).find((r) => r.originalId === item.id),
    ).toMatchObject({ content: text, score: 1 });
  });
  test("restart interrupts a persisted index job without automatic calls and allows explicit retry from the original", async () => {
    const item = await register("restart-index.txt");
    let ack!: { runId: string };
    await owner.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(741126,3)::text`;
      ack = await index(item.id);
      await runs.onModuleDestroy();
    });
    await owner.fileRun.update({
      where: { id: ack.runId },
      data: {
        status: "running",
        errorCode: null,
        completedAt: null,
        startedAt: new Date(),
      },
    });
    await runs.onModuleInit();
    expect(
      await owner.fileRun.findUniqueOrThrow({ where: { id: ack.runId } }),
    ).toMatchObject({
      status: "interrupted",
      errorCode: "api_restarted",
      inputKey: null,
    });
    expect(provider.call).not.toHaveBeenCalled();
    const retry = await request(app.getHttpServer())
      .post(`/file-runs/${ack.runId}/retry`)
      .set(headers())
      .send({})
      .expect(202);
    expect(await settled(retry.body)).toMatchObject({
      status: "succeeded",
      retryOfId: ack.runId,
      resultVersionId: item.version.id,
    });
    expect(
      await owner.fileVersion.count({ where: { originalId: item.id } }),
    ).toBe(1);
  });
  test("a stop immediately after reservation but before dispatch settles not_sent at zero cost", async () => {
    const { AuthService } = built(
      "../dist/auth/auth.service",
    ) as typeof import("../src/auth/auth.service");
    const { chunkRequestId } = built(
      "../dist/files/file-chunker",
    ) as typeof import("../src/files/file-chunker");
    const item = await register("cancel-reserved.txt"),
      auth = app.get(AuthService),
      original = auth.authorizedOperation.bind(auth);
    const spy = jest
      .spyOn(auth, "authorizedOperation")
      .mockImplementation(async (...args) => {
        const result = await original(...args);
        if (result.ok && "dispatch" in result) {
          const id = (runs as unknown as { active: string }).active;
          await runs.stop(token, context, id);
        }
        return result;
      });
    let ack!: { runId: string };
    try {
      ack = await index(item.id);
      expect((await settled(ack)).status).toBe("interrupted");
    } finally {
      spy.mockRestore();
    }
    expect(provider.call).not.toHaveBeenCalled();
    const call = await owner.modelCall.findUniqueOrThrow({
      where: {
        installationId_requestId: {
          installationId: "primary",
          requestId: chunkRequestId(ack.runId, 0),
        },
      },
    });
    expect(call).toMatchObject({
      status: "not_sent",
      chargedNanoUsd: 0n,
      errorCode: "call_cancelled",
    });
    expect(
      await owner.fileIndex.count({ where: { versionId: item.version.id } }),
    ).toBe(0);
  });
  test("a valid low input budget reduces chunk size instead of making index execution unusable", async () => {
    const text = "alpha ".repeat(300),
      item = await register("low-input.txt", Buffer.from(text));
    await owner.modelExecutionSettings.update({
      where: { installationId: "primary" },
      data: { inputTokenLimit: 512 },
    });
    expect((await settled(await index(item.id))).status).toBe("succeeded");
    expect(provider.call.mock.calls.length).toBeGreaterThan(1);
    expect(
      provider.call.mock.calls.every(
        (call) => Buffer.byteLength(call[1].input) + 256 <= 512,
      ),
    ).toBe(true);
    expect((await read(item.id)).version.searchable).toBe(true);
  });
  test("a corrupted persistent original fails before any embedding call", async () => {
    const { FileStorage } = built(
      "../dist/files/file-storage",
    ) as typeof import("../src/files/file-storage");
    const item = await register("corrupt-original.txt"),
      storage = app.get(FileStorage);
    const spy = jest
      .spyOn(storage, "read")
      .mockResolvedValueOnce(Buffer.from("different stored bytes"));
    try {
      expect(await settled(await index(item.id))).toMatchObject({
        status: "failed",
        errorCode: "storage_unavailable",
      });
    } finally {
      spy.mockRestore();
    }
    expect(provider.call).not.toHaveBeenCalled();
    expect(
      await owner.fileIndex.count({ where: { versionId: item.version.id } }),
    ).toBe(0);
  });
  test("a missing persistent original fails before any embedding call", async () => {
    const { FileStorage } = built(
      "../dist/files/file-storage",
    ) as typeof import("../src/files/file-storage");
    const item = await register("missing-original.txt"),
      version = await owner.fileVersion.findUniqueOrThrow({
        where: { id: item.version.id },
      });
    await app.get(FileStorage).remove(version.storageKey);
    expect(await settled(await index(item.id))).toMatchObject({
      status: "failed",
      errorCode: "storage_unavailable",
    });
    expect(provider.call).not.toHaveBeenCalled();
    expect(
      await owner.fileIndex.count({ where: { versionId: item.version.id } }),
    ).toBe(0);
  });
  test("indexes only persistent files and preserves legacy tables without attachment side effects", async () => {
    expect(await owner.document.count()).toBe(0);
    expect(await owner.documentChunk.count()).toBe(0);
    expect(await owner.fileIndexChunk.count()).toBeGreaterThan(0);
    expect(
      await owner.modelCall.count({
        where: { purpose: { not: "document_embedding" } },
      }),
    ).toBe(0);
  });
});
