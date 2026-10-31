import { Logger } from "@nestjs/common";
import { FileRunService } from "../src/files/file-run.service";
import type { DeploymentDatabase } from "../src/deployment/deployment-database";
import type { AuthService } from "../src/auth/auth.service";
import type { FileManagementService } from "../src/files/file-management.service";
import type { FileExtractor } from "../src/files/file-extractor";
import { fileRequestId } from "../src/files/file-run.service";
describe("D03 request identity", () => {
  test.each([
    undefined,
    null,
    [],
    "",
    "not-an-id",
    "11111111-1111-1111-8111-111111111111",
  ])("rejects invalid request ID %j", (value) => {
    expect(() => fileRequestId(value)).toThrow();
  });
  test("canonicalizes the same request across UUID case variants", () => {
    const id = "ABCDEFAB-1234-4123-8123-ABCDEFABCDEF";
    expect(fileRequestId(id)).toBe(id.toLowerCase());
  });
});

describe("D03 shutdown with unavailable persistence", () => {
  test("still cancels parsing and releases the owner connection when status writes fail", async () => {
    const updateMany = jest
      .fn()
      .mockRejectedValue(new Error("synthetic unavailable DB"));
    const cancel = jest.fn(),
      disconnect = jest.fn().mockResolvedValue(undefined);
    const service = new FileRunService(
      { prisma: { fileRun: { updateMany } } } as unknown as DeploymentDatabase,
      {} as AuthService,
      { onApplicationShutdown: jest.fn() } as unknown as FileManagementService,
      { cancel } as unknown as FileExtractor,
    );
    const internals = service as unknown as {
      owner: unknown;
      active: string;
      task: Promise<void>;
    };
    internals.owner = { $disconnect: disconnect };
    internals.active = "11111111-1111-4111-8111-111111111111";
    internals.task = Promise.resolve();
    // This unit isolates unavailable DB writes; staging synchronization is exercised
    // with real advisory locks in the D03 integration suite.
    jest
      .spyOn(
        service as unknown as {
          staging: (work: () => Promise<void>) => Promise<void>;
        },
        "staging",
      )
      .mockImplementation((work) => work());
    const log = jest.spyOn(Logger, "error").mockImplementation(() => {});
    try {
      await expect(service.onModuleDestroy()).resolves.toBeUndefined();
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(disconnect).toHaveBeenCalledTimes(1);
      expect(updateMany).toHaveBeenCalledTimes(2);
      expect(log).toHaveBeenCalledWith(
        "TOWNBASE_FILE_RUN_SHUTDOWN_UNCONFIRMED",
      );
    } finally {
      log.mockRestore();
    }
  });
});
