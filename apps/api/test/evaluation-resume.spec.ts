import {
  sameResumeContract,
  OPERATOR_ATTESTED_PROVENANCE,
} from "../scripts/evaluation-resume";
const contract = {
  kind: "ops",
  series: "partial",
  rounds: 3,
  limit: 60,
  sourceCommit: "a".repeat(40),
  questionHash: "questions",
  corpusHash: "documents",
  fixtureHashes: [["OPS-D01", "fixture"]],
  compiledHashes: [["rag-policy", "compiled"]],
};
test("top-level key order does not change execution identity or mutate the manifest", () => {
  const reordered = Object.fromEntries(Object.entries(contract).reverse());
  const original = JSON.stringify(reordered);
  expect(sameResumeContract(reordered, contract)).toBe(true);
  expect(sameResumeContract(contract, reordered)).toBe(true);
  expect(
    sameResumeContract(
      { sourceCommitProvenance: OPERATOR_ATTESTED_PROVENANCE, ...reordered },
      contract,
    ),
  ).toBe(true);
  expect(JSON.stringify(reordered)).toBe(original);
  expect(sameResumeContract({ ...reordered, rounds: 2 }, contract)).toBe(false);
  expect(sameResumeContract({ ...reordered, unexpected: true }, contract)).toBe(
    false,
  );
});
test("hash entry order and hash values remain part of execution identity", () => {
  const baseline = {
    ...contract,
    compiledHashes: [
      ["a", "hash-a"],
      ["b", "hash-b"],
    ],
  };
  expect(
    sameResumeContract(
      { ...baseline, compiledHashes: [...baseline.compiledHashes].reverse() },
      baseline,
    ),
  ).toBe(false);
  expect(
    sameResumeContract(
      { ...baseline, compiledHashes: [["a", "changed"], ["b", "hash-b"]] },
      baseline,
    ),
  ).toBe(false);
});
test("legacy identity without metadata and intermediate identity with known metadata both resume", () => {
  const withMetadata = {
    ...contract,
    sourceCommitProvenance: OPERATOR_ATTESTED_PROVENANCE,
  };
  const original = JSON.stringify(withMetadata);
  expect(sameResumeContract(contract, contract)).toBe(true);
  expect(sameResumeContract(withMetadata, contract)).toBe(true);
  expect(sameResumeContract(contract, withMetadata)).toBe(true);
  expect(JSON.stringify(withMetadata)).toBe(original);
});
test.each([
  ["kind", "shop"],
  ["series", "other"],
  ["rounds", 2],
  ["limit", 20],
  ["sourceCommit", "b".repeat(40)],
  ["questionHash", "changed"],
  ["corpusHash", "changed"],
  ["fixtureHashes", [["OPS-D01", "changed"]]],
  ["compiledHashes", [["rag-policy", "changed"]]],
])(
  "changed execution field %s cannot resume under a metadata compatibility rule",
  (key, value) => {
    expect(
      sameResumeContract(
        {
          ...contract,
          [key]: value,
          sourceCommitProvenance: OPERATOR_ATTESTED_PROVENANCE,
        },
        contract,
      ),
    ).toBe(false);
  },
);
test.each([null, undefined, [], "invalid", {}])(
  "malformed or missing previous contract is rejected: %p",
  (previous) => {
    expect(sameResumeContract(previous, contract)).toBe(false);
  },
);
test("unknown provenance, unexpected identity fields and missing hashes remain rejected", () => {
  expect(
    sameResumeContract(
      { ...contract, sourceCommitProvenance: "verified" },
      contract,
    ),
  ).toBe(false);
  expect(sameResumeContract({ ...contract, extra: "unknown" }, contract)).toBe(
    false,
  );
  const missing: Record<string, unknown> = { ...contract };
  delete missing.compiledHashes;
  expect(sameResumeContract(missing, contract)).toBe(false);
});
