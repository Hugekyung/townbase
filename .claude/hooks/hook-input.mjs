// Shared hook input parsing. A missing or malformed payload fails closed
// (exit 2) instead of silently disabling the guard.
export async function readHookInput(stdin = process.stdin) {
  // Decode once so a multibyte character split across chunks stays intact.
  const chunks = [];
  for await (const chunk of stdin)
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (value === null || typeof value !== "object" || Array.isArray(value))
      throw new Error();
    return value;
  } catch {
    throw new HookInputError();
  }
}
export class HookInputError extends Error {
  constructor() {
    super("CLAUDE_HOOK_INPUT_INVALID");
  }
}
export async function runHook(check) {
  try {
    const message = await check(await readHookInput());
    if (message) {
      process.stderr.write(message + "\n");
      process.exitCode = 2;
    }
  } catch (error) {
    process.stderr.write(
      (error instanceof HookInputError ? error.message : "CLAUDE_HOOK_FAILED") +
        "\n",
    );
    process.exitCode = 2;
  }
}
