import { Test } from "@nestjs/testing";

import {
  CHAT_MCP_SERVER_GUIDANCE,
  CHAT_MCP_SERVER_NAME,
  CHAT_MCP_SERVER_VERSION,
  ChatMcpServer,
  ChatModule,
} from "../src/chat";
import { ChatToolRegistry } from "../src/chat/chat.registry";

describe("Chat MCP scaffold", () => {
  it("describes the stdio MCP surface with the expected tool registry", () => {
    const registry = new ChatToolRegistry();
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
    const registry = new ChatToolRegistry();

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
