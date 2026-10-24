export type RuntimeProfile = "self_hosted" | "legacy_development";
export type RuntimeProfileErrorCode =
  | "unsupported_profile"
  | "legacy_in_production"
  | "legacy_in_self_hosted";
export class RuntimeProfileError extends Error {
  constructor(
    readonly code: RuntimeProfileErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RuntimeProfileError";
  }
}
export function resolveRuntimeProfile(env: NodeJS.ProcessEnv): RuntimeProfile {
  const profile = env.TOWNBASE_RUNTIME_PROFILE ?? "self_hosted";
  if (profile !== "self_hosted" && profile !== "legacy_development")
    throw new RuntimeProfileError(
      "unsupported_profile",
      "Unsupported runtime profile",
    );
  if (env.NODE_ENV === "production" && profile !== "self_hosted")
    throw new RuntimeProfileError(
      "legacy_in_production",
      "Legacy routes are unavailable in production",
    );
  return profile;
}
export function assertLegacyDevelopment(
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (resolveRuntimeProfile(env) !== "legacy_development")
    throw new RuntimeProfileError(
      "legacy_in_self_hosted",
      "Legacy entry points are unavailable in the self-hosted profile",
    );
}
