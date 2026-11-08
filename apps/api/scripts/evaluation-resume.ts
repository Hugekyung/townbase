// This is descriptive provenance, never an execution-identity field. Accept only
// the known historical tag; all actual contract fields remain strictly compared.
export const OPERATOR_ATTESTED_PROVENANCE =
  "operator_attested_not_verified_against_checkout";
function identity(value: unknown): string | null {
  if (value == null || typeof value !== "object" || Array.isArray(value))
    return null;
  const record = value as Record<string, unknown>;
  if (
    Object.hasOwn(record, "sourceCommitProvenance") &&
    record.sourceCommitProvenance !== OPERATOR_ATTESTED_PROVENANCE
  )
    return null;
  const execution = { ...record };
  delete execution.sourceCommitProvenance;
  return JSON.stringify(
    Object.fromEntries(
      Object.keys(execution)
        .sort()
        .map((key) => [key, execution[key]]),
    ),
  );
}
export function sameResumeContract(
  previous: unknown,
  current: unknown,
): boolean {
  const before = identity(previous),
    after = identity(current);
  return before != null && after != null && before === after;
}
