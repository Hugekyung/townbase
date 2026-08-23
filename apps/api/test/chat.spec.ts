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
      answer: "",
      questionId: "question-1",
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

  it("returns the source packet and citations in JSON text and structured content", async () => {
    const questionService = createMockQuestionService();
    questionService.executeQuestion = jest.fn().mockResolvedValue({
      answer: "",
      questionId: "question-1",
      requestedMode: "auto",
      resolvedMode: "documentation_gap",
      sources: [
        {
          content: "Run `pnpm test` to execute the test suite.",
          documentId: "document-1",
          chunkId: "chunk-1",
          sourceType: "repo_docs",
          title: "README",
          filePath: "README.md",
          sourceUrl: null,
          sectionTitle: "Testing",
          headingPath: ["Testing"],
          rank: 1,
          score: 0.92,
        },
      ],
      confidence: 0.8,
      isAnswerable: true,
      knowledgeGapCreated: false,
      model: "chat-test",
      latencyMs: 1,
      tokenUsage: { input: 0, output: 0 },
    });
    const registry = new ChatToolRegistry(questionService, createMockKnowledgeGapsService());

    const response = await registry.callTool("workspace_knowledge.question", {
      workspaceId: "workspace-1",
      question: "How do I run tests?",
      mode: "auto",
      topK: 5,
    });
    const structuredContent = response.structuredContent as {
      sourcePacket: readonly Readonly<Record<string, unknown>>[];
      citations: readonly Readonly<Record<string, unknown>>[];
    };

    expect(structuredContent.sourcePacket[0]).toMatchObject({
      content: "Run `pnpm test` to execute the test suite.",
      documentId: "document-1",
      chunkId: "chunk-1",
      filePath: "README.md",
      sectionTitle: "Testing",
    });
    expect(structuredContent.citations).toEqual([
      {
        rank: 1,
        title: "README",
        sourceType: "repo_docs",
        sourceReference: "README.md",
        score: 0.92,
      },
    ]);
    expect(JSON.parse(response.content[0]?.type === "text" ? response.content[0].text : "{}")).toEqual(
      expect.objectContaining({
        sourcePacket: expect.any(Array),
        citations: expect.any(Array),
      }),
    );
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
