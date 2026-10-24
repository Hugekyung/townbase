const messages = {
  administrator_unavailable:
    "Recovery requires an initialized active administrator.",
  storage_unavailable:
    "Check protected recovery storage configuration and permissions.",
  unavailable: "Check database health and deployment configuration.",
} as const;
export class RecoveryIssueError extends Error {
  constructor(readonly code: keyof typeof messages) {
    super(messages[code]);
  }
}
export function recoveryIssuanceFailure(error: unknown): string {
  const code = error instanceof RecoveryIssueError ? error.code : "unavailable";
  return `Recovery issuance failed [${code}]. ${messages[code]}`;
}
