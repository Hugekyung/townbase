import { resolveNotionSyncFixturePath } from "../src/sync";

describe("resolveNotionSyncFixturePath", () => {
  it("returns undefined without a fixture flag", () => {
    expect(resolveNotionSyncFixturePath([])).toBeUndefined();
  });

  it("parses the split fixture flag form", () => {
    expect(
      resolveNotionSyncFixturePath(["--fixture-path", "fixtures/notion.json"]),
    ).toBe("fixtures/notion.json");
  });

  it("ignores blank fixture flag values", () => {
    expect(
      resolveNotionSyncFixturePath(["--fixture-path", "   "]),
    ).toBeUndefined();
  });

  it("parses the inline fixture flag form", () => {
    expect(
      resolveNotionSyncFixturePath(["--fixture-path=fixtures/notion.json"]),
    ).toBe("fixtures/notion.json");
  });
});
