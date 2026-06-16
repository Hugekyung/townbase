import path from "node:path";

import { resolveDatabaseRuntimePath } from "../src/database-runtime";

describe("resolveDatabaseRuntimePath", () => {
  it("prefers the compiled runtime when dist exists", () => {
    const databasePackageRoot = "/workspace/packages/database";
    const builtRuntimePath = path.resolve(databasePackageRoot, "dist", "index.js");

    expect(
      resolveDatabaseRuntimePath(databasePackageRoot, (candidatePath) => candidatePath === builtRuntimePath),
    ).toBe(builtRuntimePath);
  });

  it("falls back to the source runtime when dist is missing", () => {
    const databasePackageRoot = "/workspace/packages/database";
    const sourceRuntimePath = path.resolve(databasePackageRoot, "src", "index.ts");

    expect(resolveDatabaseRuntimePath(databasePackageRoot, () => false)).toBe(sourceRuntimePath);
  });
});
