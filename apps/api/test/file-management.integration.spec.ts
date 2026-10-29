import "reflect-metadata";
import { randomBytes, createHash } from "node:crypto";
import { createRequire } from "node:module";
import {
  mkdtemp,
  mkdir,
  realpath,
  rm,
  readFile,
  readdir,
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
import { pdf, docx, encryptedPdf, zip } from "./file-fixtures";

const integration =
  process.env.TOWNBASE_FILE_MANAGEMENT_TEST === "1" ? describe : describe.skip;
integration("D02 actual DB/HTTP/storage lifecycle", () => {
  let owner: PrismaClient,
    app: NestExpressApplication,
    directory: string,
    root: string,
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
    Cookie: `townbase_session=${token}`,
  });
  const payload = (name: string, bytes: Buffer) => ({
    name,
    contentBase64: bytes.toString("base64"),
  });
  async function register(
    name = "a.txt",
    bytes: Buffer = Buffer.from("한국어 original"),
  ) {
    return (
      await request(app.getHttpServer())
        .post("/files")
        .set(headers())
        .send(payload(name, bytes))
        .expect(201)
    ).body;
  }
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    if (url.hostname !== "postgres" || url.pathname !== "/townbase_d02_test")
      throw new Error("Dedicated D02 DB required");
    owner = new PrismaClient({ datasources: { db: { url: url.toString() } } });
    if (
      (await owner.installation.count()) !== 0 ||
      (await owner.fileOriginal.count()) !== 0 ||
      (await owner.modelCall.count()) !== 0
    )
      throw new Error("Fresh D02 synthetic DB required; refuse reset");
    const workspace = await owner.workspace.create({
      data: { name: "D02 synthetic fixture" },
    });
    await owner.installation.create({
      data: {
        id: "primary",
        workspaceId: workspace.id,
        name: "D02 synthetic",
        timeZone: "UTC",
        initializedAt: new Date(),
      },
    });
    const administrator = await owner.administrator.create({
      data: {
        installationId: "primary",
        username: "d02-admin",
        passwordHash: await hashPassword("D02 synthetic fixture password!"),
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
      await mkdtemp(path.join(tmpdir(), "townbase-d02-db-")),
    );
    root = path.join(directory, "documents", "originals");
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
    storage = app.get(FileStorage);
    auth = app.get(AuthService);
  }, 30000);
  afterAll(async () => {
    await app?.close();
    await owner?.$disconnect();
    if (directory) await rm(directory, { recursive: true, force: true });
    process.env = environment;
  });
  test.each([
    ["a.txt", Buffer.from("한국어 😀\n둘째 줄")],
    ["a.md", Buffer.from("# 정책\n본문")],
    ["a.pdf", pdf()],
    ["a.docx", docx()],
  ])(
    "%s persists and independently reads protected source",
    async (name, bytes) => {
      const item = await register(name as string, bytes as Buffer);
      expect(item.version.searchable).toBe(false);
      expect(item.version.runs[0].status).toBe("extracted");
      expect(item.version).not.toHaveProperty("storageKey");
      const res = await request(app.getHttpServer())
        .get(`/files/${item.id}`)
        .set(headers())
        .expect(200);
      expect(res.body.version.extraction.segments.length).toBeGreaterThan(0);
      const reference = await request(app.getHttpServer())
        .get(item.reference)
        .set(headers())
        .expect(200);
      expect(reference.body).toEqual(bytes);
    },
    20000,
  );
  test.each([
    ["scan.pdf", pdf(null), "no_extractable_text"],
    ["encrypted.pdf", encryptedPdf(), "encrypted_file"],
    ["disguised.txt", pdf(), "invalid_format"],
    [
      "bomb.docx",
      zip([{ name: "word/bomb.xml", text: "A".repeat(100000), deflate: true }]),
      "archive_limit",
    ],
    ["fake.pdf", Buffer.from("not pdf"), "invalid_format"],
    ["bad.txt", Buffer.from([255]), "invalid_utf8"],
    ["broken.docx", Buffer.from("bad zip"), "invalid_format"],
  ])(
    "%s persists safe parse failure",
    async (name, bytes, code) => {
      const item = await register(name as string, bytes as Buffer);
      expect(item.version.extraction).toBeNull();
      expect(item.version.runs[0]).toMatchObject({
        status: "failed",
        errorCode: code,
      });
      expect(item.version.searchable).toBe(false);
    },
    20000,
  );
  test("replacement retains original identity and switches references; failed replacement never falls back", async () => {
    const initial = await register();
    const replacement = (
      await request(app.getHttpServer())
        .put(`/files/${initial.id}`)
        .set(headers())
        .send(payload("new.txt", Buffer.from("new")))
        .expect(200)
    ).body;
    expect(replacement.id).toBe(initial.id);
    expect(replacement.version.version).toBe(2);
    expect(replacement.version.id).not.toBe(initial.version.id);
    expect(
      (
        await request(app.getHttpServer())
          .get(initial.reference)
          .set(headers())
          .expect(200)
      ).body,
    ).toEqual(Buffer.from("new"));
    const failed = (
      await request(app.getHttpServer())
        .put(`/files/${initial.id}`)
        .set(headers())
        .send(payload("broken.pdf", Buffer.from("broken")))
        .expect(200)
    ).body;
    expect(failed.version.version).toBe(3);
    expect(failed.version.runs[0].status).toBe("failed");
    expect(failed.version.extraction).toBeNull();
    expect(
      (
        await request(app.getHttpServer())
          .get(initial.reference)
          .set(headers())
          .expect(200)
      ).body,
    ).toEqual(Buffer.from("broken"));
    expect(
      await owner.fileVersion.count({ where: { originalId: initial.id } }),
    ).toBe(3);
  }, 30000);
  test("identical content and names remain independent originals", async () => {
    const a = await register(),
      b = await register();
    expect(a.id).not.toBe(b.id);
  });
  test("cross-owner/workspace context is denied at stored-row boundary", async () => {
    const item = await register();
    await expect(
      service.read(token, { ...context, administratorId: "foreign" }, item.id),
    ).rejects.toThrow();
    await expect(
      service.read(token, { ...context, workspaceId: "foreign" }, item.id),
    ).rejects.toThrow();
    await request(app.getHttpServer())
      .get(`/files/${item.id}`)
      .set({ ...headers(), Cookie: "" })
      .expect(401);
  });
  test("delete revokes all references, clears text and removes all raw versions; repeat is idempotent", async () => {
    const item = await register();
    const beforeAudit = await owner.installationAuditEvent.count({
      where: { action: "file_deleted" },
    });
    await request(app.getHttpServer())
      .delete(`/files/${item.id}`)
      .set(headers())
      .send({})
      .expect(200, { deleted: true, cleanup: "complete" });
    await request(app.getHttpServer())
      .get(item.reference)
      .set(headers())
      .expect(404);
    await request(app.getHttpServer())
      .get(`/files/${item.id}`)
      .set(headers())
      .expect(404);
    expect(
      (await service.list(token, context)).items.some(
        (row) => row.id === item.id,
      ),
    ).toBe(false);
    const rows = await owner.fileVersion.findMany({
      where: { originalId: item.id },
    });
    expect(
      rows.every((row) => row.extraction == null && row.rawDeletedAt != null),
    ).toBe(true);
    expect((await readdir(root)).includes(rows[0]!.storageKey)).toBe(false);
    await request(app.getHttpServer())
      .delete(`/files/${item.id}`)
      .set(headers())
      .send({})
      .expect(200);
    expect(
      await owner.installationAuditEvent.count({
        where: { action: "file_deleted" },
      }),
    ).toBe(beforeAudit + 1);
  });
  test("unlink failure persists tombstone; restart cleanup retries and keeps unrelated files", async () => {
    const item = await register(),
      retained = await register();
    const remove = jest
      .spyOn(storage, "removeIfPresent")
      .mockRejectedValueOnce(new Error("synthetic unlink failure"));
    await request(app.getHttpServer())
      .delete(`/files/${item.id}`)
      .set(headers())
      .send({})
      .expect(200, { deleted: true, cleanup: "pending" });
    remove.mockRestore();
    await request(app.getHttpServer())
      .get(item.reference)
      .set(headers())
      .expect(404);
    service.onApplicationShutdown();
    await service.onModuleInit();
    const row = await owner.fileVersion.findUniqueOrThrow({
      where: { id: item.version.id },
    });
    expect(row.rawDeletedAt).not.toBeNull();
    expect((await readdir(root)).includes(row.storageKey)).toBe(false);
    await request(app.getHttpServer())
      .get(retained.reference)
      .set(headers())
      .expect(200);
  });
  test("startup removes an interrupted raw write with no committed DB row", async () => {
    const orphan = await storage.write(Buffer.from("interrupted synthetic"));
    service.onApplicationShutdown();
    await service.onModuleInit();
    expect((await readdir(root)).includes(orphan)).toBe(false);
  });
  test("unexpected storage entry blocks startup without traversing or deleting it", async () => {
    await writeFile(path.join(root, "unknown-file"), "preserve", {
      mode: 0o600,
    });
    service.onApplicationShutdown();
    await expect(service.onModuleInit()).rejects.toThrow("storage_unavailable");
    expect(await readFile(path.join(root, "unknown-file"), "utf8")).toBe(
      "preserve",
    );
    await rm(path.join(root, "unknown-file"));
    await service.onModuleInit();
  });
  test("sensitive extracted content is rejected without registration/raw persistence", async () => {
    const before = await owner.fileOriginal.count(),
      files = await readdir(root);
    await request(app.getHttpServer())
      .post("/files")
      .set(headers())
      .send(
        payload(
          "secret.txt",
          Buffer.from("OPENAI_API_KEY=sk-" + "x".repeat(24)),
        ),
      )
      .expect(422);
    expect(await owner.fileOriginal.count()).toBe(before);
    expect(await readdir(root)).toEqual(files);
  });
  test("cross-process file lock rejects intake without side effects", async () => {
    const before = await owner.fileOriginal.count();
    await owner.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(741126, 3)::text`;
      await request(app.getHttpServer())
        .post("/files")
        .set(headers())
        .send(payload("a.txt", Buffer.from("busy")))
        .expect(409);
    });
    expect(await owner.fileOriginal.count()).toBe(before);
  });
  test("listing is bounded and cursor is validated", async () => {
    const page = await service.list(token, context);
    expect(page.items.length).toBeLessThanOrEqual(20);
    if (page.nextCursor) {
      const next = await service.list(token, context, page.nextCursor);
      expect(
        next.items.some((row) => page.items.some((old) => row.id === old.id)),
      ).toBe(false);
    }
    await request(app.getHttpServer())
      .get("/files?cursor=invalid")
      .set(headers())
      .expect(404);
    await request(app.getHttpServer())
      .get("/files?limit=100000")
      .set(headers())
      .expect(400);
  });
  test("rolled-back registration removes the unreferenced raw file", async () => {
    const before = await owner.fileOriginal.count(),
      files = await readdir(root);
    await owner.$executeRawUnsafe(
      'ALTER TABLE "FileExtractionRun" ADD CONSTRAINT "D02_synthetic_reject" CHECK (false) NOT VALID',
    );
    try {
      await request(app.getHttpServer())
        .post("/files")
        .set(headers())
        .send(payload("rollback.txt", Buffer.from("rollback")))
        .expect(503);
    } finally {
      await owner.$executeRawUnsafe(
        'ALTER TABLE "FileExtractionRun" DROP CONSTRAINT "D02_synthetic_reject"',
      );
    }
    expect(await owner.fileOriginal.count()).toBe(before);
    expect(await readdir(root)).toEqual(files);
  });
  test("uncertain commit preserves a raw file that has a committed version", async () => {
    const original = auth.authorizedOperation.bind(auth);
    const spy = jest
      .spyOn(auth, "authorizedOperation")
      .mockImplementation(async (token, expected, work) => {
        const result = await original(token, expected, work);
        if (result.ok && "originalId" in result)
          throw new Error("synthetic response lost after commit");
        return result;
      });
    try {
      await request(app.getHttpServer())
        .post("/files")
        .set(headers())
        .send(payload("uncertain.txt", Buffer.from("committed")))
        .expect(503);
    } finally {
      spy.mockRestore();
    }
    const version = await owner.fileVersion.findFirstOrThrow({
      where: { fileName: "uncertain.txt" },
    });
    expect(await storage.read(version.storageKey)).toEqual(
      Buffer.from("committed"),
    );
    await request(app.getHttpServer())
      .get(`/files/${version.originalId}/reference`)
      .set(headers())
      .expect(200);
  });
  test("auth revocation during parser work prevents persistence and cleans the raw file", async () => {
    const before = await owner.fileOriginal.count();
    const Compiled = createRequire(__filename)(
      "../dist/files/file-extractor",
    ).FileExtractor;
    const extractor = app.get(FileExtractor);
    const spy = jest
      .spyOn(extractor, "extract")
      .mockImplementationOnce(async (...args) => {
        const value = await new Compiled().extract(...args);
        await auth.logout(token);
        return value;
      });
    await request(app.getHttpServer())
      .post("/files")
      .set(headers())
      .send(payload("a.txt", Buffer.from("revoked")))
      .expect(401);
    spy.mockRestore();
    expect(await owner.fileOriginal.count()).toBe(before);
    expect(await owner.document.count()).toBe(0);
    expect(await owner.documentChunk.count()).toBe(0);
    expect(await owner.modelCall.count()).toBe(0);
  });
});
