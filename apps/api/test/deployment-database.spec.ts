jest.mock("@townbase/database", () => ({ PrismaClient: jest.fn() }));

import { PrismaClient } from "@townbase/database";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DeploymentDatabase } from "../src/deployment/deployment-database";

describe("deployment migration readiness", () => {
  let directory: string;
  let service: DeploymentDatabase;
  const query = jest.fn();
  const disconnect = jest.fn();
  const original = process.env.TOWNBASE_MIGRATIONS_PATH;
  const finished = {
    migration_name: "001_init",
    finished_at: new Date(),
    rolled_back_at: null,
  };

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "townbase-schema-"));
    await mkdir(path.join(directory, "001_init"));
    process.env.TOWNBASE_MIGRATIONS_PATH = directory;
    query.mockReset();
    disconnect.mockReset();
    (PrismaClient as jest.Mock).mockImplementation(() => ({
      $queryRaw: query,
      $disconnect: disconnect,
    }));
    service = new DeploymentDatabase();
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
    if (original == null) delete process.env.TOWNBASE_MIGRATIONS_PATH;
    else process.env.TOWNBASE_MIGRATIONS_PATH = original;
  });

  it("requires both the exact migration set and readable foundation tables", async () => {
    query
      .mockResolvedValueOnce([{ result: 1 }])
      .mockResolvedValueOnce([finished])
      .mockResolvedValueOnce([]);
    await expect(service.check()).resolves.toEqual({
      database: "ready",
      schema: "ready",
    });
    expect(query).toHaveBeenCalledTimes(3);
  });
  it.each(
    [
      [],
      [{ ...finished, finished_at: null }],
      [finished, { ...finished, migration_name: "future" }],
      [finished, { ...finished, migration_name: "failed", finished_at: null }],
    ].map((rows) => ({ rows })),
  )(
    "rejects missing, newer or unfinished migrations: $rows",
    async ({ rows }) => {
      query
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(rows)
        .mockResolvedValueOnce([]);
      await expect(service.check()).resolves.toEqual({
        database: "ready",
        schema: "unavailable",
      });
    },
  );
  it("distinguishes a DB outage from missing schema and never returns connection errors", async () => {
    query.mockRejectedValueOnce(new Error("secret-canary"));
    await expect(service.check()).resolves.toEqual({
      database: "unavailable",
      schema: "unavailable",
    });
    query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([finished])
      .mockRejectedValueOnce(new Error("secret-canary"));
    await expect(service.check()).resolves.toEqual({
      database: "ready",
      schema: "unavailable",
    });
  });
  it("releases its DB connection on shutdown", async () => {
    await service.onApplicationShutdown();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
