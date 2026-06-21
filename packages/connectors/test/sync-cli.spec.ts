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

  it("throws on blank fixture flag values", () => {
    expect(() =>
      resolveNotionSyncFixturePath(["--fixture-path", "   "]),
    ).toThrow("A valid fixture path must be specified after --fixture-path");
  });

  it("throws when the next argument is another flag", () => {
    expect(() =>
      resolveNotionSyncFixturePath(["--fixture-path", "--another-flag"]),
    ).toThrow("A valid fixture path must be specified after --fixture-path");
  });

  it("throws when the split fixture flag is missing a value", () => {
    expect(() =>
      resolveNotionSyncFixturePath(["--fixture-path"]),
    ).toThrow("A valid fixture path must be specified after --fixture-path");
  });

  it("throws on blank inline fixture flag values", () => {
    expect(
      () => resolveNotionSyncFixturePath(["--fixture-path="]),
    ).toThrow("A valid fixture path must be specified for --fixture-path=");
  });

  it("parses the inline fixture flag form", () => {
    expect(
      resolveNotionSyncFixturePath(["--fixture-path=fixtures/notion.json"]),
    ).toBe("fixtures/notion.json");
  });
});
