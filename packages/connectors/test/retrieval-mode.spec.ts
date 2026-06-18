import {
  buildQuestionRetrievalTrace,
  selectQuestionRetrievalSources,
} from "../src/retrieval-mode";

describe("connector retrieval mode orchestration", () => {
  it("resolves auto mode, ranks candidates, and produces trace rows", () => {
    const result = selectQuestionRetrievalSources({
      question: "How do I deploy the app locally?",
      requestedMode: "auto",
      candidates: [
        {
          id: "chunk-1",
          documentId: "doc-1",
          sourceType: "repo_docs",
          knowledgeTypes: ["deployment"],
          status: "active",
          sourcePriority: 1,
          score: 0.72,
        },
        {
          id: "chunk-2",
          documentId: "doc-2",
          sourceType: "repo_readme",
          knowledgeTypes: ["onboarding"],
          status: "active",
          sourcePriority: 9,
          score: 0.61,
        },
      ],
    });

    expect(result.requestedMode).toBe("auto");
    expect(result.resolvedMode).toBe("onboarding");
    expect(result.selectedSources).toHaveLength(2);
    expect(result.selectedSources[0]?.id).toBe("chunk-2");
    expect(result.selectedSources[0]?.rank).toBe(1);
    expect(result.selectedSources[1]?.rank).toBe(2);
    expect(result.confidence).toBeGreaterThan(0.6);
    expect(result.isAnswerable).toBe(true);

    const trace = buildQuestionRetrievalTrace("workspace-1", "question-1", result);
    expect(trace.questionId).toBe("question-1");
    expect(trace.requestedMode).toBe("auto");
    expect(trace.resolvedMode).toBe("onboarding");
    expect(trace.sources).toEqual([
      {
        chunkId: "chunk-2",
        mode: "onboarding",
        rank: 1,
        score: result.selectedSources[0]?.adjustedScore,
      },
      {
        chunkId: "chunk-1",
        mode: "onboarding",
        rank: 2,
        score: result.selectedSources[1]?.adjustedScore,
      },
    ]);
  });
});
