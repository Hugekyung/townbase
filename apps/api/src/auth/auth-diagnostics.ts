import { databaseFailureCode } from "../diagnostics/database-failure";
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
  return databaseFailureCode(error) ?? "unavailable";
}

export function logAuthFailure(operation: AuthOperation, error: unknown): void {
  Logger.error(
    `Authentication operation failed [${operation}:${diagnosticCode(error)}].`,
  );
}
