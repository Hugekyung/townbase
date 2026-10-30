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
  readdir,
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
const { FileError } = built(
  "../dist/files/file-contract",
) as typeof import("../src/files/file-contract");
const { FilesModule } = built(
  "../dist/files/files.module",
) as typeof import("../src/files/files.module");
const { FileStorage } = built(
  "../dist/files/file-storage",
) as typeof import("../src/files/file-storage");
const { FileExtractor } = built(
  "../dist/files/file-extractor",
) as typeof import("../src/files/file-extractor");
const { FileManagementService } = built(
  "../dist/files/file-management.service",
) as typeof import("../src/files/file-management.service");
const { AuthService } = built(
  "../dist/auth/auth.service",
) as typeof import("../src/auth/auth.service");
import { hashPassword } from "../src/setup/password";
const { configureSelfHostedHttp } = built(
  "../dist/deployment/self-hosted-http",
) as typeof import("../src/deployment/self-hosted-http");

const integration =
  process.env.TOWNBASE_FILE_RUN_TEST === "1" ? describe : describe.skip;
integration("D03 actual persistent run queue", () => {
  let owner: PrismaClient,
    app: NestExpressApplication,
    directory: string,
    token: string,
    service: InstanceType<typeof FileManagementService>,
    storage: InstanceType<typeof FileStorage>,
    auth: InstanceType<typeof AuthService>,
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
    if (url.hostname !== "postgres" || url.pathname !== "/townbase_d03_test")
      throw new Error("Dedicated D03 DB required");
    owner = new PrismaClient({ datasources: { db: { url: url.toString() } } });
    await assertFreshFileManagementDatabase(owner);
    const workspace = await owner.workspace.create({
      data: { name: "D03 synthetic fixture" },
    });
    await owner.installation.create({
      data: {
        id: "primary",
        workspaceId: workspace.id,
        name: "D03 synthetic",
        timeZone: "UTC",
        initializedAt: new Date(),
      },
    });
    const administrator = await owner.administrator.create({
      data: {
        installationId: "primary",
        username: "d02-admin",
        passwordHash: await hashPassword("D03 synthetic fixture password!"),
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
      await mkdtemp(path.join(tmpdir(), "townbase-d03-db-")),
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
    const module = await Test.createTestingModule({
      imports: [FilesModule],
    }).compile();
    app = module.createNestApplication<NestExpressApplication>({
      bodyParser: false,
    });
    configureSelfHostedHttp(app);
    await app.init();
    service = app.get(FileManagementService);
    runs = app.get(FileRunService);
    storage = app.get(FileStorage);
    auth = app.get(AuthService);
  }, 30000);
  afterAll(async () => {
    await app?.close();
    await owner?.$disconnect();
    if (directory) await rm(directory, { recursive: true, force: true });
    process.env = environment;
  });

  async function enqueue(
    name = "run.txt",
    text = "synthetic run",
    id: string = randomUUID(),
    target?: string,
  ) {
    return (
      await request(app.getHttpServer())
        [target ? "put" : "post"](target ? `/files/${target}` : "/files")
        .set({ ...headers(), "X-Townbase-Request-Id": id })
        .send(payload(name, Buffer.from(text)))
        .expect(202)
    ).body as { runId: string; status: string; existing: boolean };
  }
  async function detail(id: string) {
    return (
      await request(app.getHttpServer())
        .get(`/file-runs/${id}`)
        .set(headers())
        .expect(200)
    ).body;
  }
  async function blocked() {
    const extractor = app.get(FileExtractor),
      original = extractor.extract.bind(extractor);
    let release!: () => void, entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const spy = jest
      .spyOn(extractor, "extract")
      .mockImplementationOnce(async (...args) => {
        entered();
        await gate;
        return original(...args);
      });
    return { release, started, spy };
  }
  test("request ID is required and no job is created for invalid input", async () => {
    const before = await owner.fileRun.count();
    await request(app.getHttpServer())
      .post("/files")
      .set({ ...headers(), "X-Townbase-Request-Id": "invalid" })
      .send(payload("a.txt", Buffer.from("x")))
      .expect(400);
    expect(await owner.fileRun.count()).toBe(before);
  });
  test("POST acknowledges before extraction, persists status/result, and request lookup survives response loss", async () => {
    const block = await blocked(),
      id = randomUUID();
    const ack = await enqueue("async.txt", "async source", id);
    try {
      await block.started;
      expect((await detail(ack.runId)).status).toBe("running");
      expect(
        await owner.fileVersion.count({ where: { fileName: "async.txt" } }),
      ).toBe(0);
      const lookup = await request(app.getHttpServer())
        .get(`/file-runs/requests/${id.toUpperCase()}`)
        .set(headers())
        .expect(200);
      expect(lookup.body.id).toBe(ack.runId);
      expect(lookup.body).not.toHaveProperty("inputKey");
    } finally {
      block.release();
      block.spy.mockRestore();
    }
    const run = await settled(ack);
    expect(run).toMatchObject({
      status: "succeeded",
      createdCount: 1,
      failedCount: 0,
    });
    expect(run.resultExtractionRunId).not.toBeNull();
    expect(
      await owner.fileExtractionRun.findUniqueOrThrow({
        where: { id: run.resultExtractionRunId! },
      }),
    ).toMatchObject({ versionId: run.resultVersionId, status: "extracted" });
    expect((await detail(ack.runId)).resource).toBe(
      `/files/${run.resultOriginalId}`,
    );
  });
  test("same request ID is canonical and conflicting payloads do not create duplicates", async () => {
    const id: string = randomUUID(),
      a = await enqueue("identity.txt", "identity", id);
    const b = await enqueue("identity.txt", "identity", id.toUpperCase());
    expect(b.runId).toBe(a.runId);
    expect(b.existing).toBe(true);
    await request(app.getHttpServer())
      .post("/files")
      .set({ ...headers(), "X-Townbase-Request-Id": id })
      .send(payload("identity.txt", Buffer.from("different")))
      .expect(409);
    await settled(a);
    expect(
      await owner.fileVersion.count({ where: { fileName: "identity.txt" } }),
    ).toBe(1);
  });
  test("other documents remain queued and execute in order while one parser is running", async () => {
    const block = await blocked();
    const first = await enqueue("order1.txt", "one");
    let second!: { runId: string }, third!: { runId: string };
    try {
      await block.started;
      second = await enqueue("order2.txt", "two");
      third = await enqueue("order3.txt", "three");
      expect((await detail(second.runId)).status).toBe("queued");
      expect((await detail(third.runId)).status).toBe("queued");
      expect(await owner.fileRun.count({ where: { status: "running" } })).toBe(
        1,
      );
    } finally {
      block.release();
      block.spy.mockRestore();
    }
    const result = await Promise.all([
      settled(first),
      settled(second),
      settled(third),
    ]);
    expect(result.every((r) => r.status === "succeeded")).toBe(true);
    expect(result[1]!.startedAt!.getTime()).toBeGreaterThanOrEqual(
      result[0]!.completedAt!.getTime(),
    );
    expect(result[2]!.startedAt!.getTime()).toBeGreaterThanOrEqual(
      result[1]!.completedAt!.getTime(),
    );
  });
  test("same target/version aliases bind to the same active run even after completion", async () => {
    const item = await register(),
      block = await blocked();
    const first = await enqueue(
        "replace.txt",
        "replace",
        randomUUID(),
        item.id,
      ),
      alias = randomUUID();
    try {
      await block.started;
      expect(
        (await enqueue("replace.txt", "replace", alias, item.id)).runId,
      ).toBe(first.runId);
      await request(app.getHttpServer())
        .put(`/files/${item.id}`)
        .set(headers())
        .send(payload("replace.txt", Buffer.from("different")))
        .expect(409);
    } finally {
      block.release();
      block.spy.mockRestore();
    }
    await settled(first);
    expect(
      (await enqueue("replace.txt", "replace", alias, item.id)).runId,
    ).toBe(first.runId);
    expect(
      await owner.fileVersion.count({ where: { originalId: item.id } }),
    ).toBe(2);
    expect(
      await owner.fileRunRequest.count({ where: { runId: first.runId } }),
    ).toBe(2);
  });
  test("manual retry links to the failed run without duplicating the source", async () => {
    const extractor = app.get(FileExtractor),
      spy = jest
        .spyOn(extractor, "extract")
        .mockRejectedValueOnce(new FileError("parser_unavailable"));
    const initial = await enqueue("retry.txt", "retry source");
    expect((await settled(initial)).status).toBe("failed");
    spy.mockRestore();
    const retryId = randomUUID();
    const response = await request(app.getHttpServer())
      .post(`/file-runs/${initial.runId}/retry`)
      .set({ ...headers(), "X-Townbase-Request-Id": retryId })
      .send({})
      .expect(202);
    const retried = await settled(response.body);
    expect(retried).toMatchObject({
      status: "succeeded",
      retryOfId: initial.runId,
      trigger: "retry",
    });
    expect(
      await owner.fileVersion.count({ where: { fileName: "retry.txt" } }),
    ).toBe(1);
    const duplicate = await request(app.getHttpServer())
      .post(`/file-runs/${initial.runId}/retry`)
      .set({ ...headers(), "X-Townbase-Request-Id": retryId })
      .send({})
      .expect(202);
    expect(duplicate.body.runId).toBe(retried.id);
    const again = await request(app.getHttpServer())
      .post(`/file-runs/${initial.runId}/retry`)
      .set(headers())
      .send({})
      .expect(202);
    expect(again.body).toMatchObject({ runId: retried.id, existing: true });
    expect(
      await owner.fileVersion.count({ where: { fileName: "retry.txt" } }),
    ).toBe(1);
  });
  test("concurrent and later retries of a failed registration share its recovered source", async () => {
    const extractor = app.get(FileExtractor),
      failure = jest
        .spyOn(extractor, "extract")
        .mockRejectedValueOnce(new FileError("parser_unavailable"));
    const parent = await enqueue("retry-family.txt", "one source");
    await settled(parent);
    failure.mockRestore();
    const block = await blocked();
    const first = (
      await request(app.getHttpServer())
        .post(`/file-runs/${parent.runId}/retry`)
        .set(headers())
        .send({})
        .expect(202)
    ).body;
    try {
      await block.started;
      const second = await request(app.getHttpServer())
        .post(`/file-runs/${parent.runId}/retry`)
        .set(headers())
        .send({})
        .expect(202);
      expect(second.body).toMatchObject({ runId: first.runId, existing: true });
    } finally {
      block.release();
      block.spy.mockRestore();
    }
    await settled(first);
    await runs.onModuleDestroy();
    await runs.onModuleInit();
    expect(
      (await owner.fileRun.findUniqueOrThrow({ where: { id: parent.runId } }))
        .inputKey,
    ).toBeNull();
    const again = await request(app.getHttpServer())
      .post(`/file-runs/${parent.runId}/retry`)
      .set(headers())
      .send({})
      .expect(202);
    expect(again.body).toMatchObject({ runId: first.runId, existing: true });
    expect(
      await owner.fileVersion.count({
        where: { fileName: "retry-family.txt" },
      }),
    ).toBe(1);
  });
  test("content failure retry and reprocessing preserve the original version", async () => {
    const ack = await enqueue("invalid.pdf", "bad pdf"),
      first = await settled(ack);
    expect(first.status).toBe("failed");
    expect(first.resultVersionId).not.toBeNull();
    const pending = (
      runs as unknown as { pending: InstanceType<typeof FileStorage> }
    ).pending;
    const read = jest
      .spyOn(pending, "read")
      .mockRejectedValue(new FileError("storage_unavailable"));
    let second!: Awaited<ReturnType<typeof settled>>;
    try {
      const retry = await request(app.getHttpServer())
        .post(`/file-runs/${ack.runId}/retry`)
        .set(headers())
        .send({})
        .expect(202);
      second = await settled(retry.body);
      expect(read).not.toHaveBeenCalled();
    } finally {
      read.mockRestore();
    }
    expect(second).toMatchObject({
      status: "failed",
      resultOriginalId: first.resultOriginalId,
      resultVersionId: first.resultVersionId,
      retryOfId: first.id,
    });
    expect(second.resultExtractionRunId).not.toBe(first.resultExtractionRunId);
    expect(
      await owner.fileVersion.count({
        where: { originalId: first.resultOriginalId! },
      }),
    ).toBe(1);
  });
  test("unchanged reprocessing persists a new run with an unchanged count", async () => {
    const item = await register(),
      before = await owner.fileVersion.count();
    const ack = await request(app.getHttpServer())
      .post(`/files/${item.id}/reprocess`)
      .set(headers())
      .send({})
      .expect(202);
    const run = await settled(ack.body);
    expect(run).toMatchObject({
      status: "succeeded",
      unchangedCount: 1,
      updatedCount: 0,
      resultVersionId: item.version.id,
    });
    expect(await owner.fileVersion.count()).toBe(before);
    const version = await owner.fileVersion.findUniqueOrThrow({
      where: { id: item.version.id },
    });
    expect((await storage.read(version.storageKey)).length).toBeGreaterThan(0);
  });
  test("stopping queued work is idempotent and requires explicit retry", async () => {
    let ack!: { runId: string };
    await owner.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(741126,3)::text`;
      ack = await enqueue("stop-queued.txt", "queued");
      await request(app.getHttpServer())
        .post(`/file-runs/${ack.runId}/stop`)
        .set(headers())
        .send({})
        .expect(200);
      await request(app.getHttpServer())
        .post(`/file-runs/${ack.runId}/stop`)
        .set(headers())
        .send({})
        .expect(200);
    });
    const stopped = await settled(ack);
    expect(stopped).toMatchObject({
      status: "interrupted",
      errorCode: "user_stopped",
      resultVersionId: null,
    });
    expect(
      await owner.fileVersion.count({ where: { fileName: "stop-queued.txt" } }),
    ).toBe(0);
    const retry = await request(app.getHttpServer())
      .post(`/file-runs/${ack.runId}/retry`)
      .set(headers())
      .send({})
      .expect(202);
    expect((await settled(retry.body)).status).toBe("succeeded");
  });
  test("stopping running work prevents its late result from being committed", async () => {
    const block = await blocked(),
      ack = await enqueue("stop-running.txt", "running");
    try {
      await block.started;
      await request(app.getHttpServer())
        .post(`/file-runs/${ack.runId}/stop`)
        .set(headers())
        .send({})
        .expect(200);
    } finally {
      block.release();
      block.spy.mockRestore();
    }
    expect((await settled(ack)).status).toBe("interrupted");
    expect(
      await owner.fileVersion.count({
        where: { fileName: "stop-running.txt" },
      }),
    ).toBe(0);
  });
  test("a second API execution owner is refused without changing pending history", async () => {
    const db = app.get(
      (
        built(
          "../dist/deployment/deployment-database",
        ) as typeof import("../src/deployment/deployment-database")
      ).DeploymentDatabase,
    );
    const second = new FileRunService(
      db,
      auth,
      service,
      app.get(FileExtractor),
    );
    await expect(second.onModuleInit()).rejects.toThrow();
    await second.onModuleDestroy();
    expect(
      (await settled(await enqueue("owner.txt", "single owner"))).status,
    ).toBe("succeeded");
  });
  test("restart interrupts persisted active jobs and does not automatically rerun them", async () => {
    let ack!: { runId: string };
    await owner.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(741126,3)::text`;
      ack = await enqueue("restart.txt", "restart source");
      await runs.onModuleDestroy();
    });
    await owner.fileRun.update({
      where: { id: ack.runId },
      data: {
        status: "running",
        errorCode: null,
        startedAt: new Date(),
        completedAt: null,
      },
    });
    await runs.onModuleInit();
    expect(await detail(ack.runId)).toMatchObject({
      status: "interrupted",
      errorCode: "api_restarted",
    });
    expect(
      await owner.fileVersion.count({ where: { fileName: "restart.txt" } }),
    ).toBe(0);
    const retry = await request(app.getHttpServer())
      .post(`/file-runs/${ack.runId}/retry`)
      .set(headers())
      .send({})
      .expect(202);
    expect((await settled(retry.body)).status).toBe("succeeded");
  });
  test("deleted sources keep historical identity but cannot be retried or downloaded", async () => {
    const ack = await enqueue("deleted.pdf", "bad pdf"),
      run = await settled(ack);
    await request(app.getHttpServer())
      .delete(`/files/${run.resultOriginalId}`)
      .set(headers())
      .send({})
      .expect(200);
    expect(await detail(ack.runId)).toMatchObject({
      id: ack.runId,
      sourceDeleted: true,
      resource: null,
    });
    await request(app.getHttpServer())
      .post(`/file-runs/${ack.runId}/retry`)
      .set(headers())
      .send({})
      .expect(404);
    await request(app.getHttpServer())
      .get(`/files/${run.resultOriginalId}/reference`)
      .set(headers())
      .expect(404);
  });
  test("queue capacity is bounded, but duplicate requests still resolve while full", async () => {
    const ids: Array<{ runId: string }> = [],
      requestId = randomUUID();
    await owner.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(741126,3)::text`;
        for (let i = 0; i < 20; i++)
          ids.push(
            await enqueue(
              `capacity${i}.txt`,
              "capacity",
              i === 0 ? requestId : randomUUID(),
            ),
          );
        await request(app.getHttpServer())
          .post("/files")
          .set(headers())
          .send(payload("capacity-extra.txt", Buffer.from("capacity")))
          .expect(429);
        expect(
          (await enqueue("capacity0.txt", "capacity", requestId)).runId,
        ).toBe(ids[0]!.runId);
        for (const ack of ids)
          await request(app.getHttpServer())
            .post(`/file-runs/${ack.runId}/stop`)
            .set(headers())
            .send({})
            .expect(200);
      },
      { timeout: 30000 },
    );
    expect(
      await owner.fileRun.count({
        where: { status: { in: ["queued", "running"] } },
      }),
    ).toBe(0);
  }, 30000);
  test("run routes protect identity and reject malformed mutation bodies", async () => {
    const ack = await enqueue("protected.txt", "protected");
    await expect(
      runs.read(token, { ...context, workspaceId: "foreign" }, ack.runId),
    ).rejects.toThrow();
    await settled(ack);
    await request(app.getHttpServer())
      .get(`/file-runs/${ack.runId}`)
      .set({ ...headers(), Cookie: "" })
      .expect(401);
    await request(app.getHttpServer())
      .get(`/file-runs/${ack.runId}`)
      .set({ ...headers(), "X-Workspace-Id": "foreign" })
      .expect(403);
    await request(app.getHttpServer())
      .post(`/file-runs/${ack.runId}/retry`)
      .set(headers())
      .send({ unexpected: true })
      .expect(400);
    await request(app.getHttpServer())
      .post(`/file-runs/${ack.runId}/stop`)
      .set(headers())
      .send([])
      .expect(400);
  });
  test("history pages are bounded, newest-first, and scoped by the stored cursor", async () => {
    const first = (
      await request(app.getHttpServer())
        .get("/file-runs")
        .set(headers())
        .expect(200)
    ).body;
    expect(first.items.length).toBe(20);
    for (let i = 1; i < first.items.length; i++)
      expect(new Date(first.items[i].createdAt).getTime()).toBeLessThanOrEqual(
        new Date(first.items[i - 1].createdAt).getTime(),
      );
    const next = (
      await request(app.getHttpServer())
        .get(`/file-runs?cursor=${first.nextCursor}`)
        .set(headers())
        .expect(200)
    ).body;
    expect(
      next.items.some((row: { id: string }) =>
        first.items.some((old: { id: string }) => old.id === row.id),
      ),
    ).toBe(false);
    await request(app.getHttpServer())
      .get("/file-runs?cursor=11111111-1111-4111-8111-111111111111")
      .set(headers())
      .expect(404);
    await request(app.getHttpServer())
      .get("/file-runs?limit=10000")
      .set(headers())
      .expect(400);
  });
  test("expired history and request aliases are removed without deleting a retained source", async () => {
    const id: string = randomUUID(),
      ack = await enqueue("retained.txt", "retained", id),
      run = await settled(ack);
    const past = new Date(Date.now() - 91 * 86400_000);
    await owner.fileRun.update({
      where: { id: ack.runId },
      data: { createdAt: past, startedAt: past, completedAt: past },
    });
    await request(app.getHttpServer())
      .get(`/file-runs/${ack.runId}`)
      .set(headers())
      .expect(404);
    await runs.onModuleDestroy();
    await runs.onModuleInit();
    expect(
      await owner.fileRun.findUnique({ where: { id: ack.runId } }),
    ).toBeNull();
    expect(
      await owner.fileRunRequest.count({ where: { runId: ack.runId } }),
    ).toBe(0);
    await request(app.getHttpServer())
      .get(`/files/${run.resultOriginalId}/reference`)
      .set(headers())
      .expect(200);
  });
  test("sensitive input is failed and removed from the pending store", async () => {
    const block = await blocked(),
      ack = await enqueue(
        "sensitive.txt",
        "OPENAI_API_KEY=sk-" + "x".repeat(24),
      );
    let key: string | null = null;
    try {
      await block.started;
      key = (
        await owner.fileRun.findUniqueOrThrow({ where: { id: ack.runId } })
      ).inputKey;
      expect(key).not.toBeNull();
      expect(
        await readdir(path.join(directory, "documents", "pending")),
      ).toContain(key);
    } finally {
      block.release();
      block.spy.mockRestore();
    }
    const run = await settled(ack);
    expect(run).toMatchObject({
      status: "failed",
      errorCode: "sensitive_file",
      resultVersionId: null,
    });
    for (let i = 0; i < 100; i++) {
      if (
        (await owner.fileRun.findUniqueOrThrow({ where: { id: run.id } }))
          .inputKey == null
      )
        break;
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(
      (await owner.fileRun.findUniqueOrThrow({ where: { id: run.id } }))
        .inputKey,
    ).toBeNull();
    expect(
      await readdir(path.join(directory, "documents", "pending")),
    ).not.toContain(key);
    expect(
      await owner.fileVersion.count({ where: { fileName: "sensitive.txt" } }),
    ).toBe(0);
    await request(app.getHttpServer())
      .post(`/file-runs/${run.id}/retry`)
      .set(headers())
      .send({})
      .expect(409);
  });
  test("the queue creates no embeddings, shared chunks or provider calls", async () => {
    expect(await owner.document.count()).toBe(0);
    expect(await owner.documentChunk.count()).toBe(0);
    expect(await owner.modelCall.count()).toBe(0);
  });
});
