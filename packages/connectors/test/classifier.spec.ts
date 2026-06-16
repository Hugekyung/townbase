import {
  buildChunkMetadata,
  classifyNotionPage,
  classifyRepositoryPath,
} from "../src/classification";

describe("classifyRepositoryPath", () => {
  it("classifies documentation paths deterministically", () => {
    expect(classifyRepositoryPath({ filePath: "README.md" })).toMatchObject({
      sourceType: "repo_readme",
      knowledgeTypes: ["onboarding"],
      status: "active",
      classifierVersion: "phase2-v1",
    });

    expect(classifyRepositoryPath({ filePath: "adr/2024-06-decision.md" })).toMatchObject({
      sourceType: "adr",
      knowledgeTypes: ["architecture"],
      status: "active",
    });

    expect(classifyRepositoryPath({ filePath: "prd/payment-flow.md" })).toMatchObject({
      sourceType: "prd",
      knowledgeTypes: ["product_history"],
      status: "active",
    });

    expect(classifyRepositoryPath({ filePath: "prisma/schema.prisma" })).toMatchObject({
      sourceType: "schema",
      knowledgeTypes: ["database"],
      status: "active",
    });

    expect(classifyRepositoryPath({ filePath: ".github/PULL_REQUEST_TEMPLATE.md" })).toMatchObject({
      sourceType: "pr_template",
      knowledgeTypes: ["code_convention"],
      status: "active",
    });
  });

  it("flags deprecated and archived repo paths", () => {
    expect(classifyRepositoryPath({ filePath: "docs/deprecated/old-guide.md" })).toMatchObject({
      status: "deprecated",
    });

    expect(classifyRepositoryPath({ filePath: "docs/archive/old-guide.md" })).toMatchObject({
      status: "archived",
    });
  });
});

describe("buildChunkMetadata", () => {
  it("reuses the shared classification contract for chunk payloads", () => {
    const classification = classifyNotionPage({
      title: "Getting Started",
      pathSegments: ["Onboarding"],
      archived: undefined,
    });

    expect(
      buildChunkMetadata({
        sourceType: classification.sourceType,
        knowledgeTypes: classification.knowledgeTypes,
        domainTags: classification.domainTags,
        status: classification.status,
        matchedRules: classification.matchedRules,
        chunkType: "markdown",
        sourcePriority: 3,
      }),
    ).toEqual({
      sourceType: "notion_page",
      knowledgeTypes: ["onboarding"],
      domainTags: ["onboarding"],
      status: "active",
      classifierVersion: "phase2-v1",
      matchedRules: ["title:onboarding", "path:onboarding"],
      chunkType: "markdown",
      sourcePriority: 3,
    });
  });
});
