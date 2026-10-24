import { Logger } from "@nestjs/common";
import { createRequire } from "node:module";
// Resolve Prisma through the package that owns that dependency.
const { Prisma } = createRequire(require.resolve("@townbase/database"))(
  "@prisma/client",
) as {
  Prisma: {
    PrismaClientInitializationError: new (
      message: string,
      version: string,
      code: string,
    ) => Error;
  };
};
import { logAuthFailure } from "../src/auth/auth-diagnostics";

describe("safe authentication diagnostics", () => {
  afterEach(() => jest.restoreAllMocks());
  it.each(["P1001", "P1002", "P1017"])(
    "recognizes real Prisma initialization errorCode %s without logging secrets",
    (code) => {
      const log = jest.spyOn(Logger, "error").mockImplementation();
      logAuthFailure(
        "access",
        new Prisma.PrismaClientInitializationError(
          "postgresql://secret-canary@private",
          "test",
          code,
        ),
      );
      expect(log).toHaveBeenCalledWith(
        "Authentication operation failed [access:database_unavailable].",
      );
      expect(JSON.stringify(log.mock.calls)).not.toContain("secret-canary");
    },
  );
  it.each([
    [{ code: null, errorCode: "P1001" }, "database_unavailable"],
    [{ code: undefined, errorCode: "P1002" }, "database_unavailable"],
    [{ code: "P2024", errorCode: "P1001" }, "database_transaction_unavailable"],
    [{ errorCode: "secret-canary", message: "secret-canary" }, "unavailable"],
    [undefined, "unavailable"],
  ])(
    "uses nullish fallback and permits only known codes: %p",
    (error, expected) => {
      const log = jest.spyOn(Logger, "error").mockImplementation();
      logAuthFailure("session", error);
      expect(log).toHaveBeenCalledWith(
        `Authentication operation failed [session:${expected}].`,
      );
    },
  );
});
