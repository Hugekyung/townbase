import { RuntimeProfileError } from "../runtime-profile";

export type McpStartupStage = "runtime-profile" | "application" | "transport";
export function mcpStartupFailure(
  stage: McpStartupStage,
  error: unknown,
): string {
  // Only fixed profile codes are logged. Error messages/stacks may contain secrets.
  if (error instanceof RuntimeProfileError) {
    const code = [
      "unsupported_profile",
      "legacy_in_production",
      "legacy_in_self_hosted",
    ].find((allowed) => allowed === error.code);
    if (code)
      return `MCP startup failed [runtime-profile:${code}]. Check runtime profile.`;
  }
  return `MCP startup failed [${stage}]. Check development configuration.`;
}
