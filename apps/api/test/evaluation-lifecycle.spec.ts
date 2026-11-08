import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import {
  sameResumeContract,
  OPERATOR_ATTESTED_PROVENANCE,
} from "../scripts/evaluation-resume";
import { randomUUID, createHash } from "node:crypto";

// Execute the actual runner control flow, with only DB/model/filesystem effects
// replaced. No live key, real provider, host /data write, or paid call is possible.
async function run(
  kind: "attachments" | "retrieval" | "basic",
  failWork = false,
  failClose = false,
  options: { basicLock?: "exists" | "acquire"; failDisconnect?: boolean } = {},
) {
  const dirs = new Set<string>(),
    files = new Map<string, string>();
  const results = new Map<string, unknown>();
  const lockClose = jest.fn(async () => {});
  const disconnect = jest.fn(async () => {
      if (options.failDisconnect) throw Error("disconnect failed");
    }),
    close = jest.fn(async () => {
      if (failClose) throw Error("close failed");
    });
  let cases = 0,
    packets = 0;
  const owner = {
    $disconnect: disconnect,
    installation: {
      findFirst: async () => ({ name: "Synthetic ops" }),
      findUnique: async () => ({
        name: kind === "attachments" ? "Synthetic diagnostic" : "Synthetic ops",
      }),
    },
    modelCredential: { findUnique: async () => ({ active: true }) },
    modelCall: { findMany: async () => [] },
    attachment: { findUnique: async () => ({ rawDeletedAt: new Date() }) },
    document: { count: async () => 0 },
    documentChunk: { count: async () => 0 },
    knowledgeGap: { count: async () => 0 },
    actionDraft: { count: async () => 0 },
  };
  const symbols = {
    DeploymentModule: "module",
    AuthService: "auth",
    AgentService: "agent",
    ModelIntegrationService: "integration",
    ModelExecutionService: "execution",
    AttachmentService: "attachments",
    AttachmentStore: "attachmentStore",
    RagStore: "rag",
    FileIndexService: "index",
    PRICE_VERSION: "synthetic-price",
    strategyFor: () => ({ knowledgeTypes: [] }),
    selectSources: (_mode: unknown, sources: unknown[]) => ({
      sources,
      answerable: true,
    }),
    promptFor: () => ({}),
  };
  const services: Record<string, unknown> = {
    auth: {
      login: async () => ({ ok: true, token: "synthetic" }),
      requester: async () => ({ requester: { installationId: "primary" } }),
    },
    agent: {
      snapshot: async () => ({ agent: { revision: 1 } }),
      configure: async () => ({ ok: true }),
    },
    integration: { setTransfers: async () => ({ ok: true }) },
    execution: {
      configure: async () => ({ ok: true }),
      snapshot: async () => ({ settings: { monthlyBudgetUsd: "0.45" } }),
      execute: async () => ({
        call: { status: "succeeded" },
        result: { embedding: [1] },
      }),
    },
    attachments: {
      upload: async () => ({ id: randomUUID() }),
      ask: async (_t: unknown, _c: unknown, input: { requestId: string }) => {
        if (failWork) throw Error("synthetic work failure");
        cases++;
        const result = {
          status: "answered",
          requestId: input.requestId,
          answer: "synthetic",
        };
        results.set(input.requestId, result);
        return result;
      },
    },
    attachmentStore: {
      read: async (_t: unknown, _c: unknown, id: string) => results.get(id),
    },
    rag: {
      admit: async () => ({
        admission: {
          turn: {
            embeddingRequestId: randomUUID(),
            resolvedMode: "onboarding",
          },
          config: { sourceSelection: "all" },
          inputLimit: 16000,
        },
      }),
      recordSources: async () => {
        if (failWork) throw Error("synthetic work failure");
        packets++;
      },
      fail: async () => {},
    },
    index: { search: async () => [{ id: randomUUID() }] },
  };
  const app = {
    init: async () => {
      throw Error("synthetic init failure after app creation");
    },
    close,
    get: (token: string) => {
      if (!(token in services)) throw Error("Unmocked service " + token);
      return services[token];
    },
  };
  const unlink = jest.fn(async () => {});
  const errors = jest.fn();
  const fakeFs = {
    open: async () => {
      if (kind === "basic" && options.basicLock === "acquire")
        return { close: lockClose };
      throw Object.assign(Error("exists"), { code: "EEXIST" });
    },
    unlink,
    readFile: async (name: string) => {
      if (kind === "basic" && /(?:manifest\.json|questions\.jsonl)$/.test(name))
        throw Object.assign(Error("missing"), { code: "ENOENT" });
      return "synthetic-secret-not-a-key";
    },
    mkdir: async (dir: string, options: { recursive?: boolean }) => {
      if (dirs.has(dir) && !options?.recursive)
        throw Object.assign(Error("exists"), { code: "EEXIST" });
      dirs.add(dir);
    },
    writeFile: async (name: string, value: string) => {
      files.set(name, value);
    },
    appendFile: async (name: string, value: string) => {
      files.set(name, (files.get(name) ?? "") + value);
    },
  };
  let time = 0;
  class Clock extends Date {
    static now() {
      time += 10000;
      return time;
    }
  }
  const environment = {
    env: {
      TOWNBASE_LIVE_EVALUATION: "1",
      TOWNBASE_EVAL_CORPUS: "ops",
      TOWNBASE_EVAL_SERIES: "lifecycle",
      TOWNBASE_EVAL_SOURCE_COMMIT: "a".repeat(40),
      DATABASE_URL:
        "postgresql://synthetic@postgres:5432/" +
        (kind === "attachments"
          ? "townbase_live_diagnostic_test"
          : "townbase_live_ops_test"),
    },
    exitCode: 0,
    stderr: { write: jest.fn() },
  };
  const built = (name: string) => {
    if (name === "@townbase/database")
      return {
        PrismaClient: class {
          constructor() {
            return owner;
          }
        },
      };
    if (name === "@nestjs/core")
      return {
        NestFactory: {
          createApplicationContext: async () => app,
          create: async () => app,
        },
      };
    if (name.startsWith("../dist/")) return symbols;
    throw Error("Unmocked built require " + name);
  };
  const requireMock = (name: string) => {
    if (name === "reflect-metadata") return {};
    if (name === "node:module") return { createRequire: () => built };
    if (name === "node:fs/promises") return fakeFs;
    if (name === "node:crypto") return { randomUUID, createHash };
    if (name === "node:path") return path;
    if (name === "node:os") return {};
    if (name === "./evaluation-resume")
      return { sameResumeContract, OPERATOR_ATTESTED_PROVENANCE };
    if (name === "./evaluation-fixtures")
      return {
        unicodePdf: () => Buffer.from("pdf"),
        unicodeDocx: () => Buffer.from("docx"),
        corpusFixtures: async () => ({
          documents: [],
          original: "synthetic corpus",
          questionText: "synthetic questions",
          questions: [{ id: "OPS-Q01", question: "synthetic" }],
        }),
      };
    throw Error("Unmocked require " + name);
  };
  const filename = path.resolve(
    __dirname,
    "../scripts/" +
      (kind === "attachments"
        ? "evaluate-attachments"
        : kind === "basic"
          ? "evaluate-basic"
          : "measure-retrieval") +
      ".ts",
  );
  const script = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
  }).outputText;
  let cleanupFailure: unknown;
  try {
    await vm.runInNewContext(script, {
      require: requireMock,
      exports: {},
      __filename: filename,
      __dirname: path.dirname(filename),
      process: environment,
      Date: Clock,
      URL,
      Buffer,
      performance,
      setTimeout: (work: () => void) => {
        work();
        return 0;
      },
      console: { log: jest.fn(), error: errors },
    });
  } catch (error) {
    cleanupFailure = error;
  }
  return {
    disconnect,
    close,
    lockClose,
    cases,
    packets,
    environment,
    cleanupFailure,
    dirs,
    files,
    errors,
    unlink,
  };
}
describe.each(["attachments", "retrieval"] as const)(
  "%s evaluation resource lifecycle",
  (kind) => {
    test("success closes app and DB without recreating its output directory", async () => {
      const result = await run(kind);
      expect(result.cleanupFailure).toBeUndefined();
      expect(result.environment.exitCode).toBe(0);
      expect(result.close).toHaveBeenCalledTimes(1);
      expect(result.disconnect).toHaveBeenCalledTimes(1);
      expect(kind === "attachments" ? result.cases : result.packets).toBe(
        kind === "attachments" ? 12 : 3,
      );
      expect(result.files.size).toBeGreaterThan(0);
    });
    test("work failure still closes both resources", async () => {
      const result = await run(kind, true);
      expect(result.cleanupFailure).toBeUndefined();
      expect(result.environment.exitCode).toBe(1);
      expect(result.close).toHaveBeenCalledTimes(1);
      expect(result.disconnect).toHaveBeenCalledTimes(1);
    });
    test("app close failure cannot skip DB disconnect", async () => {
      const result = await run(kind, false, true);
      expect(result.cleanupFailure).toMatchObject({ message: "close failed" });
      expect(result.disconnect).toHaveBeenCalledTimes(1);
    });
  },
);

test("an existing evaluation lock is diagnosed without deleting another run's lock", async () => {
  const result = await run("basic");
  expect(result.cleanupFailure).toBeUndefined();
  expect(result.environment.exitCode).toBe(1);
  expect(result.disconnect).toHaveBeenCalledTimes(1);
  expect(result.unlink).not.toHaveBeenCalled();
  const message = JSON.parse(result.errors.mock.calls[0]![0]);
  expect(message.reason).toBe("Evaluation run lock exists");
  expect(message.lockFile).toBe("/data/evidence/ops/lifecycle/.run.lock");
  expect(message.recovery).toContain("Never automatically retry");
});

describe("basic evaluation cleanup after an acquired lock and created app", () => {
  test("initialization failure still closes both resources and releases only its own lock", async () => {
    const result = await run("basic", false, false, { basicLock: "acquire" });
    expect(result.environment.exitCode).toBe(1);
    expect(result.cleanupFailure).toBeUndefined();
    expect(result.close).toHaveBeenCalledTimes(1);
    expect(result.disconnect).toHaveBeenCalledTimes(1);
    expect(result.lockClose).toHaveBeenCalledTimes(1);
    expect(result.unlink).toHaveBeenCalledWith(
      "/data/evidence/ops/lifecycle/.run.lock",
    );
    expect(result.cases + result.packets).toBe(0);
  });
  test.each([
    { close: true, db: false },
    { close: false, db: true },
    { close: true, db: true },
  ])("failed cleanup retains the owned lock: %p", async (failure) => {
    const result = await run("basic", false, failure.close, {
      basicLock: "acquire",
      failDisconnect: failure.db,
    });
    expect(result.cleanupFailure).toMatchObject({
      message: failure.db ? "disconnect failed" : "close failed",
    });
    expect(result.close).toHaveBeenCalledTimes(1);
    expect(result.disconnect).toHaveBeenCalledTimes(1);
    expect(result.lockClose).toHaveBeenCalledTimes(1);
    expect(result.unlink).not.toHaveBeenCalled();
    expect(result.cases + result.packets).toBe(0);
  });
});
