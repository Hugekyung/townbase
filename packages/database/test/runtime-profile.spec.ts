import {
  assertLegacyDevelopment,
  resolveRuntimeProfile,
} from "../src/runtime-profile";
describe("shared runtime exposure policy", () => {
  it("keeps development fixtures available and closes production by default", () => {
    expect(resolveRuntimeProfile({})).toBe("legacy_development");
    expect(resolveRuntimeProfile({ NODE_ENV: "production" })).toBe(
      "self_hosted",
    );
    expect(() => assertLegacyDevelopment({ NODE_ENV: "test" })).not.toThrow();
  });
  it.each([
    { TOWNBASE_RUNTIME_PROFILE: "self_hosted" },
    { NODE_ENV: "production" },
    { NODE_ENV: "production", TOWNBASE_RUNTIME_PROFILE: "legacy_development" },
    { TOWNBASE_RUNTIME_PROFILE: "unknown" },
  ])("refuses legacy execution before any IO: %j", (env) => {
    expect(() => assertLegacyDevelopment(env)).toThrow();
  });
});
