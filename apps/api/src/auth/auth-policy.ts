export const SESSION_ABSOLUTE_MS = 8 * 60 * 60 * 1000;
export const SESSION_IDLE_MS = 30 * 60 * 1000;
export const RECOVERY_TTL_MS = 60 * 60 * 1000;
export const AUTH_WINDOW_MS = 15 * 60 * 1000;
export const SESSION_COOKIE = "townbase_session";
export function validPassword(value: unknown): value is string {
  return (
    typeof value === "string" &&
    [...value].length >= 15 &&
    [...value].length <= 128 &&
    !value.includes("\0")
  );
}
export function fields(
  body: unknown,
  keys: string[],
): body is Record<string, unknown> {
  return (
    body != null &&
    typeof body === "object" &&
    !Array.isArray(body) &&
    Object.keys(body).sort().join(",") === [...keys].sort().join(",")
  );
}
