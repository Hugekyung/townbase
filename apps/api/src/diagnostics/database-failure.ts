// Shared allowlist only. Each caller retains its own unknown/domain fallback.
export function databaseFailureCode(
  error: unknown,
): "database_unavailable" | "database_transaction_unavailable" | undefined {
  const code =
    error != null && typeof error === "object"
      ? (("code" in error ? error.code : undefined) ??
        ("errorCode" in error ? error.errorCode : undefined))
      : undefined;
  if (["P1001", "P1002", "P1017"].some((allowed) => code === allowed))
    return "database_unavailable";
  if (["P1008", "P2024", "P2028"].some((allowed) => code === allowed))
    return "database_transaction_unavailable";
  return undefined;
}
