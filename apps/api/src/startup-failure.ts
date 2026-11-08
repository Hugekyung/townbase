export const STARTUP_STAGES = [
  "runtime-profile",
  "module-loading",
  "application",
  "web-artifacts",
  "port-configuration",
  "listen",
] as const;
export const STARTUP_ERRNOS = [
  "ENOENT",
  "EACCES",
  "EADDRINUSE",
  "EADDRNOTAVAIL",
] as const;
export type StartupStage = (typeof STARTUP_STAGES)[number];
const diagnosticCode = (stage: StartupStage, errno?: string) =>
  "TOWNBASE_STARTUP_" +
  stage.replace(/-/g, "_").toUpperCase() +
  (errno ? "_" + errno : "");
export const STARTUP_DIAGNOSTIC_CODES = STARTUP_STAGES.flatMap((stage) => [
  diagnosticCode(stage),
  ...STARTUP_ERRNOS.map((errno) => diagnosticCode(stage, errno)),
]);
function safeErrno(error: unknown) {
  const code =
    error != null && typeof error === "object" && "code" in error
      ? error.code
      : undefined;
  return STARTUP_ERRNOS.find((allowed) => allowed === code);
}
export function startupFailure(stage: StartupStage, error: unknown): string {
  const code = safeErrno(error);
  return `Townbase startup failed [${stage}${code ? `:${code}` : ""}]. Check deployment configuration.`;
}
export function startupDiagnostic(stage: StartupStage, error: unknown): string {
  return diagnosticCode(stage, safeErrno(error));
}
