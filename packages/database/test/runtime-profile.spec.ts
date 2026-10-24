import {
  assertLegacyDevelopment,
  resolveRuntimeProfile,
} from "../src/runtime-profile";
describe("shared runtime exposure policy", () => {
  it("closes every environment by default and requires explicit legacy opt-in", () => {
    expect(resolveRuntimeProfile({})).toBe("self_hosted");
    expect(resolveRuntimeProfile({ NODE_ENV: "production" })).toBe(
      "self_hosted",
    );
    expect(() =>
      assertLegacyDevelopment({
        NODE_ENV: "test",
        TOWNBASE_RUNTIME_PROFILE: "legacy_development",
      }),
    ).not.toThrow();
  });
  it.each([
    {},
    { NODE_ENV: "development" },
    { NODE_ENV: "test" },
    { TOWNBASE_RUNTIME_PROFILE: "self_hosted" },
    { NODE_ENV: "production" },
    { NODE_ENV: "production", TOWNBASE_RUNTIME_PROFILE: "legacy_development" },
    { TOWNBASE_RUNTIME_PROFILE: "unknown" },
  ])("refuses legacy execution before any IO: %j", (env) => {
    expect(() => assertLegacyDevelopment(env)).toThrow();
  });
});
