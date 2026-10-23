const messages = {
  already_initialized: "Administrator setup is already closed.",
  workspace_mismatch: "Configured workspace does not match the installation.",
  workspace_unavailable:
    "Configured workspace is missing. Check migration and workspace configuration.",
  storage_unavailable:
    "Check protected bootstrap storage configuration and permissions.",
  unavailable: "Check database health and deployment configuration.",
} as const;

export class SetupIssueError extends Error {
  constructor(readonly code: keyof typeof messages) {
    super(messages[code]);
  }
}

export function issuanceFailure(error: unknown): string {
  const code = error instanceof SetupIssueError ? error.code : "unavailable";
  // Never echo an unknown message, stack, path, DB query or credentials.
  return `Bootstrap issuance failed [${code}]. ${messages[code]}`;
}
