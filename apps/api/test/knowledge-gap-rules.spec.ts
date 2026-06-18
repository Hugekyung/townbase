import { deriveKnowledgeGapCandidate, shouldCreateKnowledgeGap } from "../src/knowledge-gaps/knowledge-gap-rules";

describe("knowledge gap rules", () => {
  it("creates a gap candidate when the answer is not supported enough", () => {
    const candidate = deriveKnowledgeGapCandidate({
      questionId: "question-1",
      question: "How do I add the schema migration?",
      requestedMode: "documentation_gap",
      resolvedMode: "documentation_gap",
      confidence: 0.42,
      isAnswerable: false,
      knowledgeGap: "No source explains the migration flow.",
      sources: [
        {
          documentId: "document-1",
          chunkId: "chunk-1",
          sourceType: "schema",
          title: "schema.prisma",
          filePath: "packages/database/prisma/schema.prisma",
          sourceUrl: null,
          sectionTitle: null,
          headingPath: [],
          rank: 1,
          score: 0.43,
        },
      ],
    });

    expect(shouldCreateKnowledgeGap({
      questionId: "question-1",
      question: "How do I add the schema migration?",
      requestedMode: "documentation_gap",
      resolvedMode: "documentation_gap",
      confidence: 0.42,
      isAnswerable: false,
      knowledgeGap: "No source explains the migration flow.",
      sources: [],
    })).toBe(true);

    expect(candidate).toMatchObject({
      questionId: "question-1",
      category: "database",
      title: "Documentation gap: How do I add the schema migration",
      description: "No source explains the migration flow.",
      suggestedDocumentTitle: "Document How do I add the schema migration",
      suggestedMarkdownPath: "docs/gaps/database-how-do-i-add-the-schema-migration.md",
      suggestedGithubIssueTitle: "Document How do I add the schema migration",
      priority: "medium",
      relatedMode: "documentation_gap",
      similarQuestionCount: 0,
    });
  });

  it("does not create a gap candidate when the answer is supported", () => {
    expect(
      shouldCreateKnowledgeGap({
        questionId: "question-2",
        question: "What is the local dev command?",
        requestedMode: "onboarding",
        resolvedMode: "onboarding",
        confidence: 0.91,
        isAnswerable: true,
        knowledgeGap: null,
        sources: [
          {
            documentId: "document-1",
            chunkId: "chunk-1",
            sourceType: "repo_docs",
            title: "README",
            filePath: "README.md",
            sourceUrl: null,
            sectionTitle: "Setup",
            headingPath: ["Setup"],
            rank: 1,
            score: 0.91,
          },
        ],
      }),
    ).toBe(false);
  });
});
