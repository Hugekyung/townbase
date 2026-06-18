import { ChatToolRegistry } from "../src/chat";

describe("MCP knowledge-gap tool", () => {
  it("is discoverable and returns the deferred phase 11 contract", async () => {
    const registry = new ChatToolRegistry();

    expect(registry.listTools().map((tool) => tool.name)).toContain(
      "workspace_knowledge.knowledge_gap",
    );

    await expect(
      registry.callTool("workspace_knowledge.knowledge_gap", {
        workspaceId: "workspace-1",
        query: "What is missing from the docs?",
      }),
    ).resolves.toMatchObject({
      structuredContent: {
        workspaceId: "workspace-1",
        query: "What is missing from the docs?",
        status: "deferred_phase11",
        knowledgeGapCreated: false,
        candidates: [],
      },
    });
  });
});
