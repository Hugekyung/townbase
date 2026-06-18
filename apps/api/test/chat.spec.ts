import { Test } from "@nestjs/testing";

import {
  CHAT_MCP_SERVER_GUIDANCE,
  CHAT_MCP_SERVER_NAME,
  CHAT_MCP_SERVER_VERSION,
  ChatMcpServer,
  ChatModule,
} from "../src/chat";
import { ChatToolRegistry } from "../src/chat/chat.registry";
import { createMockKnowledgeGapsService, createMockQuestionService } from "./chat-test-helpers";

describe("Chat MCP scaffold", () => {
  it("describes the stdio MCP surface with the expected tool registry", () => {
    const questionService = createMockQuestionService();
    questionService.executeQuestion = jest.fn().mockResolvedValue({
      questionId: "question-1",
      answer: "",
      requestedMode: "auto",
      resolvedMode: "documentation_gap",
      sources: [],
      confidence: 0,
      isAnswerable: false,
      knowledgeGapCreated: false,
      model: "chat-test",
      latencyMs: 0,
      tokenUsage: {
        input: 0,
        output: 0,
      },
    });
    const registry = new ChatToolRegistry(questionService, createMockKnowledgeGapsService());
    const server = new ChatMcpServer(registry);

    expect(server.describeSurface()).toEqual({
      serverName: CHAT_MCP_SERVER_NAME,
      serverVersion: CHAT_MCP_SERVER_VERSION,
      guidance: CHAT_MCP_SERVER_GUIDANCE,
      transportKind: "stdio",
      tools: [
        expect.objectContaining({
          name: "workspace_knowledge.question",
        }),
        expect.objectContaining({
          name: "workspace_knowledge.knowledge_gap",
        }),
        expect.objectContaining({
          name: "workspace_knowledge.draft",
        }),
      ],
    });
  });

  it("returns a deterministic scaffold response for unsupported tools", async () => {
    const registry = new ChatToolRegistry(
      createMockQuestionService(),
      createMockKnowledgeGapsService(),
    );

    await expect(registry.callTool("workspace_knowledge.unknown", undefined)).resolves.toEqual({
      content: [
        {
          type: "text",
          text: "Unsupported MCP tool: workspace_knowledge.unknown",
        },
      ],
      isError: true,
    });
  });

  it("resolves the MCP server from the Nest module with its registry intact", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ChatModule],
    }).compile();

    const server = moduleRef.get(ChatMcpServer);

    expect(server.describeSurface()).toEqual({
      serverName: CHAT_MCP_SERVER_NAME,
      serverVersion: CHAT_MCP_SERVER_VERSION,
      guidance: CHAT_MCP_SERVER_GUIDANCE,
      transportKind: "stdio",
      tools: [
        expect.objectContaining({ name: "workspace_knowledge.question" }),
        expect.objectContaining({ name: "workspace_knowledge.knowledge_gap" }),
        expect.objectContaining({ name: "workspace_knowledge.draft" }),
      ],
    });
  });
});
