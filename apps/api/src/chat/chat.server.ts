import { Injectable } from "@nestjs/common";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";

import {
  CHAT_MCP_SERVER_GUIDANCE,
  CHAT_MCP_SERVER_NAME,
  CHAT_MCP_SERVER_VERSION,
} from "./chat.constants";
import { ChatToolRegistry } from "./chat.registry";

export type ChatMcpSurface = Readonly<{
  serverName: string;
  serverVersion: string;
  guidance: string;
  transportKind: "stdio";
  tools: readonly Tool[];
}>;

@Injectable()
export class ChatMcpServer {
  public constructor(private readonly registry: ChatToolRegistry) {}

  public describeSurface(): ChatMcpSurface {
    return {
      serverName: CHAT_MCP_SERVER_NAME,
      serverVersion: CHAT_MCP_SERVER_VERSION,
      guidance: CHAT_MCP_SERVER_GUIDANCE,
      transportKind: "stdio",
      tools: this.registry.listTools(),
    };
  }

  public buildServer(): Server {
    const server = new Server(
      {
        name: CHAT_MCP_SERVER_NAME,
        version: CHAT_MCP_SERVER_VERSION,
      },
      {
        instructions: CHAT_MCP_SERVER_GUIDANCE,
        capabilities: {
          tools: {
            listChanged: false,
          },
        },
      },
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: this.registry.listTools(),
    }));

    server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
      return this.registry.callTool(
        request.params.name,
        request.params.arguments as Readonly<Record<string, unknown>> | undefined,
      );
    });

    return server;
  }

  public async startStdio(): Promise<void> {
    const transport = new StdioServerTransport();
    const server = this.buildServer();
    await server.connect(transport);
  }
}
