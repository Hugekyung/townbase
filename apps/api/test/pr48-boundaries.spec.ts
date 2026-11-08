import {
  mkdtemp,
  rm,
  realpath,
  writeFile,
  mkdir,
  readFile,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { DeletionJournal } from "../src/operations/deletion-journal";
import {
  AuthService,
  type AdministratorContext,
} from "../src/auth/auth.service";
import { DeploymentDatabase } from "../src/deployment/deployment-database";
import { FileStorage } from "../src/files/file-storage";
import { taskInput } from "../src/attachments/attachment-policy";
import { corpusFixtures } from "../scripts/evaluation-fixtures";
import { exactExcerpts } from "../src/rag/rag-policy";
const context: AdministratorContext = {
  installationId: "primary",
  workspaceId: "test",
  administratorId: "owner",
  username: "admin",
  expiresAt: "2030-01-01T00:00:00Z",
};
const id = "11111111-1111-4111-8111-111111111111";
let root: string;
const old = process.env.TOWNBASE_OPERATIONS_PATH;
beforeEach(async () => {
  root = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "townbase-review-")),
  );
  process.env.TOWNBASE_OPERATIONS_PATH = root;
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  if (old == null) delete process.env.TOWNBASE_OPERATIONS_PATH;
  else process.env.TOWNBASE_OPERATIONS_PATH = old;
});
test("durable deletion applies immediately; DB failure blocks auth and readiness until restart", async () => {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    installation: { findFirst: jest.fn().mockResolvedValue({ id: "primary" }) },
    fileOriginal: {
      findFirst: jest.fn().mockResolvedValue({ deletedAt: null }),
      updateMany: jest.fn().mockRejectedValue(new Error("DB_OFFLINE")),
    },
  };
  const db = {
    operationsBlocked: false,
    prisma: {
      $transaction: jest.fn(async (f: (t: typeof tx) => unknown) => f(tx)),
    },
  } as unknown as DeploymentDatabase;
  const auth = {
    authorizedOperation: jest.fn(async (_t, _c, f) => ({
      ok: true,
      ...(await f(tx, context)),
    })),
  } as unknown as AuthService;
  const journal = new DeletionJournal(db, auth);
  await expect(journal.accept("t", context, "file", id)).rejects.toThrow(
    "DB_OFFLINE",
  );
  expect(await journal.records()).toHaveLength(1);
  expect(db.operationsBlocked).toBe(true);
  expect(await DeploymentDatabase.prototype.check.call(db)).toEqual({
    database: "unavailable",
    schema: "unavailable",
  });
  const guardedAuth = new AuthService(db);
  await expect(guardedAuth.requester("a".repeat(43))).rejects.toThrow(
    "Deletion replay required",
  );
});
test("repeated deletion of a deleted row writes no new permanent record", async () => {
  const auth = {
    authorizedOperation: jest.fn(async (_t, _c, f) => ({
      ok: true,
      ...(await f(
        {
          fileOriginal: { findFirst: async () => ({ deletedAt: new Date() }) },
        },
        context,
      )),
    })),
  } as unknown as AuthService;
  const journal = new DeletionJournal({} as DeploymentDatabase, auth);
  await journal.accept("t", context, "file", id);
  expect(await journal.records()).toEqual([]);
});
test.each([NaN, Infinity, 0, -1, 1.1])(
  "invalid read bound %s fails before file access",
  async (bound) => {
    await expect(
      new FileStorage(path.join(root, "missing")).read(id + ".bin", bound),
    ).rejects.toMatchObject({ code: "storage_unavailable" });
  },
);
test("oversized caller read bound cannot lift the20MiB hard ceiling", async () => {
  const storage = new FileStorage(path.join(root, "files"));
  const key = await storage.write(Buffer.from("small"));
  const filename = path.join(root, "files", key);
  const { open } = await import("node:fs/promises");
  const h = await open(filename, "r+");
  try {
    await h.truncate(20 * 1024 * 1024 + 1);
  } finally {
    await h.close();
  }
  await expect(storage.read(key, 100 * 1024 * 1024)).rejects.toMatchObject({
    code: "storage_unavailable",
  });
});
test.each([["summary"], {}, null, 123])(
  "operation coercion is rejected: %p",
  (operation) => {
    expect(() =>
      taskInput({
        requestId: id,
        question: "요약",
        operation,
        attachmentIds: [id],
        requestedMode: "auto",
      }),
    ).toThrow();
  },
);
test("short exact tail remains grounded; changed numbers are never repaired", () => {
  expect(
    exactExcerpts(
      "반품 접수는 수령 후 가능합니다. 7일.",
      "반품 접수는 수령 후 가능합니다.\n기준은 다음과 같습니다. 7일.",
    ),
  ).toEqual(["반품 접수는 수령 후 가능합니다.", "7일."]);
  expect(
    exactExcerpts(
      "반품 접수는 수령 후 가능합니다. 8일.",
      "반품 접수는 수령 후 가능합니다.\n기준은 다음과 같습니다. 7일.",
    ),
  ).toBeNull();
});
test("corpus prefixes and boolean labels fail closed", async () => {
  const source = path.resolve(__dirname, "../../../docs/evaluation/v0.2");
  for (const mutation of ["prefix", "boolean"]) {
    const dir = path.join(root, mutation);
    await mkdir(dir);
    let docs = await readFile(path.join(source, "ops-corpus.md"), "utf8");
    let qs = await readFile(path.join(source, "ops-questions.md"), "utf8");
    if (mutation === "prefix") docs = docs.replace(/OPS-D01/g, "SHOP-D01");
    else qs = qs.replace(/\| true \|/, "| typo |");
    await writeFile(path.join(dir, "ops-corpus.md"), docs);
    await writeFile(path.join(dir, "ops-questions.md"), qs);
    await expect(corpusFixtures(dir, "ops")).rejects.toThrow();
  }
});

test("successful private stop survives a concurrent cleanup storage lock", async () => {
  const { AttachmentService } =
    await import("../src/attachments/attachment.service");
  const { Logger } = await import("@nestjs/common");
  const logger = jest.spyOn(Logger, "error").mockImplementation(() => {});
  try {
    const result = { requestId: id, status: "interrupted" };
    const store = {
      stop: jest.fn().mockResolvedValue(undefined),
      cleanup: jest.fn().mockRejectedValue({ status: 409 }),
      read: jest.fn().mockResolvedValue(result),
    };
    const service = new AttachmentService(
      store as never,
      {} as never,
      {} as never,
      {} as never,
    );
    await expect(service.stop("t", context, id)).resolves.toBe(result);
    expect(store.stop).toHaveBeenCalledTimes(1);
    expect(store.read).toHaveBeenCalledTimes(1);
    expect(logger).toHaveBeenCalledWith("TOWNBASE_ATTACHMENT_CLEANUP_FAILED");
  } finally {
    logger.mockRestore();
  }
});
