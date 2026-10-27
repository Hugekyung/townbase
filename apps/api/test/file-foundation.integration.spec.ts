import "reflect-metadata";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdtemp, realpath, rm, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PrismaClient } from "@townbase/database";
import { DeploymentDatabase } from "../src/deployment/deployment-database";
import {
  AuthService,
  type AdministratorContext,
} from "../src/auth/auth.service";
import { hashPassword } from "../src/setup/password";
import type { FileFoundation as FoundationType } from "../src/files/file-foundation";
import { FileStorage } from "../src/files/file-storage";
import type { FileExtractor as ExtractorType } from "../src/files/file-extractor";
import { docx, pdf } from "./file-fixtures";
const { FileExtractor } = createRequire(__filename)(
  "../dist/files/file-extractor",
) as { FileExtractor: typeof ExtractorType };
const { FileFoundation } = createRequire(__filename)(
  "../dist/files/file-foundation",
) as { FileFoundation: typeof FoundationType };
const integration =
  process.env.TOWNBASE_FILE_FOUNDATION_TEST === "1" ? describe : describe.skip;
integration("D01 scoped file foundation, actual PostgreSQL and parser", () => {
  let owner: PrismaClient,
    runtime: DeploymentDatabase,
    auth: AuthService,
    context: AdministratorContext;
  let directory: string,
    token: string,
    foundation: FoundationType,
    extractor: ExtractorType,
    storage: FileStorage;
  const originalEnv = { ...process.env };
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    if (url.hostname !== "postgres" || url.pathname !== "/townbase_d01_test")
      throw new Error("Dedicated D01 DB required");
    owner = new PrismaClient({ datasources: { db: { url: url.toString() } } });
    url.username = "townbase_runtime";
    url.password = (
      await readFile(process.env.TOWNBASE_RUNTIME_PASSWORD_FILE!, "utf8")
    ).trim();
    process.env.DATABASE_URL = url.toString();
    runtime = new DeploymentDatabase();
    auth = new AuthService(runtime);
    const workspace = await owner.workspace.create({
      data: { name: "D01 synthetic fixture" },
    });
    await owner.installation.create({
      data: {
        id: "primary",
        workspaceId: workspace.id,
        name: "D01 synthetic",
        timeZone: "UTC",
        initializedAt: new Date(),
      },
    });
    const administrator = await owner.administrator.create({
      data: {
        installationId: "primary",
        username: "d01-admin",
        passwordHash: await hashPassword("D01 synthetic fixture password!"),
      },
    });
    context = {
      installationId: "primary",
      workspaceId: workspace.id,
      administratorId: administrator.id,
      username: administrator.username,
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    };
  });
  beforeEach(async () => {
    await owner.fileExtractionRun.deleteMany();
    await owner.fileVersion.deleteMany();
    await owner.fileOriginal.deleteMany();
    token = randomBytes(32).toString("base64url");
    const createdAt = new Date();
    await owner.administratorSession.create({
      data: {
        tokenHash: createHash("sha256").update(token).digest("hex"),
        installationId: "primary",
        administratorId: context.administratorId,
        expiresAt: new Date(context.expiresAt),
        createdAt,
        lastSeenAt: createdAt,
      },
    });
    directory = await realpath(
      await mkdtemp(path.join(tmpdir(), "townbase-d01-db-")),
    );
    storage = new FileStorage(directory);
    extractor = new FileExtractor();
    foundation = new FileFoundation(auth, extractor, storage);
  });
  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
  });
  afterAll(async () => {
    await runtime?.prisma.$disconnect();
    await owner?.$disconnect();
    process.env = originalEnv;
  });
  test.each([
    ["a.txt", Buffer.from("한국어 😀\n둘째 줄")],
    ["a.md", Buffer.from("# 정책\n정책 본문")],
    ["a.docx", docx()],
    ["a.pdf", pdf()],
  ])(
    "%s original/run/extraction persist with independent readback",
    async (name, bytes) => {
      const ids = await foundation.create(
        token,
        context,
        name as string,
        bytes as Buffer,
      );
      const readback = await new FileFoundation(
        auth,
        new FileExtractor(),
        new FileStorage(directory),
      ).read(token, context, ids.originalId);
      expect(readback.versions).toHaveLength(1);
      expect(readback.versions[0]).toMatchObject({
        id: ids.versionId,
        sourceType: "uploaded_file",
        knowledgeTypes: ["unknown"],
        domainTags: [],
        documentStatus: "active",
        extraction: { format: (name as string).split(".")[1] },
        runs: [{ id: ids.runId, status: "extracted", errorCode: null }],
      });
      expect(readback.versions[0]).not.toHaveProperty("storageKey");
      const row = await owner.fileVersion.findUniqueOrThrow({
        where: { id: ids.versionId },
      });
      expect(await new FileStorage(directory).read(row.storageKey)).toEqual(
        bytes,
      );
      expect(row.contentHash).toBe(
        createHash("sha256")
          .update(bytes as Buffer)
          .digest("hex"),
      );
      expect(await owner.document.count()).toBe(0);
      expect(await owner.documentChunk.count()).toBe(0);
      expect(await owner.modelCall.count()).toBe(0);
    },
    20000,
  );
  test("failed extraction is stored as failed, never indexed", async () => {
    const ids = await foundation.create(token, context, "scan.pdf", pdf(null));
    const readback = await foundation.read(token, context, ids.originalId);
    expect(readback.versions[0]?.extraction).toBeNull();
    expect(readback.versions[0]?.runs[0]).toMatchObject({
      status: "failed",
      errorCode: "no_extractable_text",
    });
  }, 20000);
  test("same content creates independent originals; same name does not replace implicitly", async () => {
    const a = await foundation.create(
      token,
      context,
      "a.txt",
      Buffer.from("same"),
    );
    const b = await foundation.create(
      token,
      context,
      "a.txt",
      Buffer.from("same"),
    );
    expect(a.originalId).not.toBe(b.originalId);
    expect(a.versionId).not.toBe(b.versionId);
    expect(await owner.fileOriginal.count()).toBe(2);
  });
  test("unauthenticated/wrong installation/workspace/owner cannot read or create", async () => {
    const ids = await foundation.create(
      token,
      context,
      "a.txt",
      Buffer.from("private"),
    );
    for (const expected of [
      { ...context, installationId: "other" },
      { ...context, workspaceId: "other" },
      { ...context, administratorId: "other" },
    ]) {
      await expect(
        foundation.read(token, expected, ids.originalId),
      ).rejects.toMatchObject({ status: 401 });
      await expect(
        foundation.create(token, expected, "b.txt", Buffer.from("other")),
      ).rejects.toMatchObject({ status: 401 });
    }
    await expect(
      foundation.read(undefined, context, ids.originalId),
    ).rejects.toMatchObject({ status: 401 });
    expect(await owner.fileOriginal.count()).toBe(1);
  });
  test("logout while parsing -> no rows, generated original cleaned up", async () => {
    const extract = extractor.extract.bind(extractor);
    jest.spyOn(extractor, "extract").mockImplementation(async (name, bytes) => {
      await owner.administratorSession.update({
        where: { tokenHash: createHash("sha256").update(token).digest("hex") },
        data: { revokedAt: new Date() },
      });
      return extract(name, bytes);
    });
    await expect(
      foundation.create(token, context, "a.txt", Buffer.from("private")),
    ).rejects.toMatchObject({ status: 401 });
    expect(await owner.fileOriginal.count()).toBe(0);
    expect(await readdir(directory)).toEqual([]);
  });
  test("DB insertion failure rolls back all rows and cleans raw file", async () => {
    await owner.$executeRaw`ALTER TABLE "FileExtractionRun" ADD CONSTRAINT "D01_reject_run" CHECK (false) NOT VALID`;
    try {
      await expect(
        foundation.create(token, context, "a.txt", Buffer.from("private")),
      ).rejects.toThrow();
    } finally {
      await owner.$executeRaw`ALTER TABLE "FileExtractionRun" DROP CONSTRAINT "D01_reject_run"`;
    }
    expect(await owner.fileOriginal.count()).toBe(0);
    expect(await owner.fileVersion.count()).toBe(0);
    expect(await readdir(directory)).toEqual([]);
  });
  test("DB rejects wrong owner, cross-install version and malformed extracted payload", async () => {
    const ids = await foundation.create(
      token,
      context,
      "a.txt",
      Buffer.from("private"),
    );
    await expect(
      owner.fileOriginal.create({
        data: {
          id: randomUUID(),
          installationId: "primary",
          ownerAdministratorId: "wrong-owner",
          title: "bad",
        },
      }),
    ).rejects.toThrow();
    await expect(
      owner.fileVersion.update({
        where: { id: ids.versionId },
        data: { installationId: "other" },
      }),
    ).rejects.toThrow();
    await expect(
      owner.fileVersion.update({
        where: { id: ids.versionId },
        data: { extraction: {} },
      }),
    ).rejects.toThrow();
    await expect(
      owner.fileExtractionRun.update({
        where: { id: ids.runId },
        data: { status: "failed", errorCode: null },
      }),
    ).rejects.toThrow();
  });
});
