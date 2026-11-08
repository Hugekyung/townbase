export type StartupStage =
  | "runtime-profile"
  | "module-loading"
  | "application"
  | "web-artifacts"
  | "port-configuration"
  | "listen";

export function startupFailure(stage: StartupStage, error: unknown): string {
  const code =
    error != null && typeof error === "object" && "code" in error
      ? error.code
      : undefined;
  const safeCode = ["ENOENT", "EACCES", "EADDRINUSE", "EADDRNOTAVAIL"].find(
    (allowed) => allowed === code,
  );
  return `Townbase startup failed [${stage}${safeCode ? `:${safeCode}` : ""}]. Check deployment configuration.`;
}

export function startupDiagnostic(stage: StartupStage, error: unknown): string {
  const safe = startupFailure(stage, error);
  const errno = /:(ENOENT|EACCES|EADDRINUSE|EADDRNOTAVAIL)\]/.exec(safe)?.[1];
  return (
    "TOWNBASE_STARTUP_" +
    stage.replace(/-/g, "_").toUpperCase() +
    (errno ? "_" + errno : "")
  );
}
