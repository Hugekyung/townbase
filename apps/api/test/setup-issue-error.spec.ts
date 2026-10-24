import { issuanceFailure, SetupIssueError } from "../src/setup/issue-error";

describe("bootstrap operator diagnostics", () => {
  it.each([
    "already_initialized",
    "workspace_mismatch",
    "workspace_unavailable",
    "storage_unavailable",
    "unavailable",
  ] as const)("reports the safe %s code", (code) => {
    expect(issuanceFailure(new SetupIssueError(code))).toContain(`[${code}]`);
  });
  it.each([
    new Error("secret-canary postgres://password@host/db"),
    { message: "secret-canary", code: "workspace_mismatch" },
    "secret-canary",
  ])("redacts unknown failures", (error) => {
    expect(issuanceFailure(error)).toContain("[unavailable]");
    expect(issuanceFailure(error)).not.toContain("secret-canary");
  });
});
