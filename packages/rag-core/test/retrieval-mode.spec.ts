import {
  buildRetrievalStrategy,
  classifyAutoRetrievalMode,
  rankRetrievalCandidates,
  scoreRetrievalCandidate,
  resolveRetrievalMode,
  type RetrievalCandidate,
} from "../src/retrieval-mode";

describe("retrieval mode strategy", () => {
  it("classifies onboarding questions deterministically", () => {
    expect(classifyAutoRetrievalMode("How do I run the workspace locally?")).toBe("onboarding");
    expect(classifyAutoRetrievalMode("How do I deploy the app locally?")).toBe("onboarding");
  });

  it("classifies product history questions deterministically", () => {
    expect(classifyAutoRetrievalMode("Why did we introduce phase 7?")).toBe("product_history");
    expect(classifyAutoRetrievalMode("What changed in the decision log?")).toBe("product_history");
  });

  it("classifies documentation gap questions deterministically", () => {
    expect(classifyAutoRetrievalMode("What is missing from the docs?")).toBe("documentation_gap");
    expect(classifyAutoRetrievalMode("Which part is undocumented?")).toBe("documentation_gap");
  });

  it("falls back safely for nullish questions", () => {
    expect(classifyAutoRetrievalMode(undefined)).toBe("onboarding");
    expect(classifyAutoRetrievalMode(null)).toBe("onboarding");
  });

  it("resolves explicit modes without auto classification", () => {
    expect(resolveRetrievalMode("onboarding", "ignored")).toBe("onboarding");
    expect(resolveRetrievalMode("documentation_gap", "ignored")).toBe("documentation_gap");
  });

  it("ranks higher priority onboarding candidates ahead of lower priority ones", () => {
    const strategy = buildRetrievalStrategy("onboarding");
    const candidates: readonly RetrievalCandidate[] = [
      {
        id: "chunk-1",
        documentId: "doc-1",
        sourceType: "repo_docs",
        knowledgeTypes: ["deployment"],
        status: "active",
        sourcePriority: 1,
        score: 0.84,
      },
      {
        id: "chunk-2",
        documentId: "doc-2",
        sourceType: "repo_readme",
        knowledgeTypes: ["onboarding"],
        status: "active",
        sourcePriority: 9,
        score: 0.72,
      },
    ];

    const ranked = rankRetrievalCandidates(strategy, candidates);

    expect(ranked).toHaveLength(2);
    expect(ranked[0]?.id).toBe("chunk-2");
    expect(ranked[1]?.id).toBe("chunk-1");
    expect(ranked[0]?.rank).toBe(1);
    expect(ranked[1]?.rank).toBe(2);
  });

  it("treats non-finite source priorities as zero in candidate scoring", () => {
    const strategy = buildRetrievalStrategy("product_history");
    const candidate: RetrievalCandidate = {
      id: "chunk-3",
      documentId: "doc-3",
      sourceType: "prd",
      knowledgeTypes: ["product_history"],
      status: "active",
      sourcePriority: Number.NaN,
      score: 0.5,
    };

    expect(scoreRetrievalCandidate(strategy, candidate)).toBeCloseTo(0.69, 5);
  });
});
