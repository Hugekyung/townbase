import { ChatToolRegistry } from "../src/chat";
import { createMockKnowledgeGapsService, createMockQuestionService } from "./chat-test-helpers";

describe("MCP draft tool", () => {
  it("is discoverable and returns the deferred phase 12 contract", async () => {
    const registry = new ChatToolRegistry(
      createMockQuestionService(),
      createMockKnowledgeGapsService(),
    );

    expect(registry.listTools().map((tool) => tool.name)).toContain(
      "workspace_knowledge.draft",
    );

    await expect(
      registry.callTool("workspace_knowledge.draft", {
        workspaceId: "workspace-1",
        topic: "Phase 1 schema notes",
      }),
    ).resolves.toMatchObject({
      structuredContent: {
        workspaceId: "workspace-1",
        topic: "Phase 1 schema notes",
        status: "deferred_phase12",
        draftCreated: false,
        draft: null,
      },
    });
  });
});
