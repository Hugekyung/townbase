import { Logger } from "@nestjs/common";
import { RecoveryIssueError } from "./recovery-error";
export type AuthOperation =
  | "login"
  | "session"
  | "logout"
  | "password"
  | "recovery"
  | "access";
function diagnosticCode(error: unknown): string {
  if (error instanceof RecoveryIssueError) return error.code;
  const code =
    error != null && typeof error === "object"
      ? (("code" in error ? error.code : undefined) ??
        ("errorCode" in error ? error.errorCode : undefined))
      : undefined;
  if (typeof code === "string" && ["P1001", "P1002", "P1017"].includes(code))
    return "database_unavailable";
  if (typeof code === "string" && ["P1008", "P2024", "P2028"].includes(code))
    return "database_transaction_unavailable";
  return "unavailable";
}

export function logAuthFailure(operation: AuthOperation, error: unknown): void {
  Logger.error(
    `Authentication operation failed [${operation}:${diagnosticCode(error)}].`,
  );
}
