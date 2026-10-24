export type RuntimeProfile = "self_hosted" | "legacy_development";
export function resolveRuntimeProfile(env: NodeJS.ProcessEnv): RuntimeProfile {
  const profile =
    env.TOWNBASE_RUNTIME_PROFILE ??
    (env.NODE_ENV === "production" ? "self_hosted" : "legacy_development");
  if (profile !== "self_hosted" && profile !== "legacy_development")
    throw new Error("Unsupported runtime profile");
  if (env.NODE_ENV === "production" && profile !== "self_hosted")
    throw new Error("Legacy routes are unavailable in production");
  return profile;
}
export function assertLegacyDevelopment(
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (resolveRuntimeProfile(env) !== "legacy_development")
    throw new Error(
      "Legacy entry points are unavailable in the self-hosted profile",
    );
}
