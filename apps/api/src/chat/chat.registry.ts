import { Injectable } from "@nestjs/common";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";

import { parseChatQuestionInput, resolveChatQuestionSelection } from "./chat-contract";
import { CHAT_MCP_TOOLS } from "./chat.constants";
import { ChatQuestionService } from "./chat.service";

const toolContent = (message: string): CallToolResult => ({
  content: [
    {
      type: "text",
      text: message,
    },
  ],
  isError: true,
});

export type ChatToolName = keyof typeof CHAT_MCP_TOOLS;

export const CHAT_TOOL_NAMES = Object.values(CHAT_MCP_TOOLS).map((tool) => tool.name);

const readRequiredString = (
  value: Readonly<Record<string, unknown>> | undefined,
  key: string,
): string => {
  const rawValue = value?.[key];

  if (typeof rawValue !== "string") {
    throw new Error(`${key} must be a non-empty string`);
  }

  const trimmedValue = rawValue.trim();

  if (trimmedValue.length === 0) {
    throw new Error(`${key} must be a non-empty string`);
  }

  return trimmedValue;
};

@Injectable()
export class ChatToolRegistry {
  public constructor(private readonly questionService: ChatQuestionService) {}

  public listTools(): readonly Tool[] {
    return [
      CHAT_MCP_TOOLS.question,
      CHAT_MCP_TOOLS.knowledgeGap,
      CHAT_MCP_TOOLS.draft,
    ];
  }

  public async callTool(
    name: string,
    arguments_: Readonly<Record<string, unknown>> | undefined,
  ): Promise<CallToolResult> {
    switch (name) {
      case CHAT_MCP_TOOLS.question.name:
        try {
          const parsedInput = parseChatQuestionInput(arguments_);
          const selection = resolveChatQuestionSelection(parsedInput);
          const result = await this.questionService.executeQuestion(parsedInput);

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    requestedMode: selection.requestedMode,
                    resolvedMode: selection.resolvedMode,
                    strategy: selection.strategy.mode,
                    result,
                  },
                  null,
                  2,
                ),
              },
            ],
            structuredContent: {
              requestedMode: selection.requestedMode,
              resolvedMode: selection.resolvedMode,
              strategy: selection.strategy.mode,
              result,
            },
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : "Invalid MCP question input";
          return toolContent(message);
        }
      case CHAT_MCP_TOOLS.knowledgeGap.name:
        try {
          const workspaceId = readRequiredString(arguments_, "workspaceId");
          const query = readRequiredString(arguments_, "query");

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    workspaceId,
                    query,
                    status: "deferred_phase11",
                    knowledgeGapCreated: false,
                    candidates: [],
                  },
                  null,
                  2,
                ),
              },
            ],
            structuredContent: {
              workspaceId,
              query,
              status: "deferred_phase11",
              knowledgeGapCreated: false,
              candidates: [],
            },
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : "Invalid MCP knowledge-gap input";
          return toolContent(message);
        }
      case CHAT_MCP_TOOLS.draft.name:
        try {
          const workspaceId = readRequiredString(arguments_, "workspaceId");
          const topic = readRequiredString(arguments_, "topic");

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    workspaceId,
                    topic,
                    status: "deferred_phase12",
                    draftCreated: false,
                    draft: null,
                  },
                  null,
                  2,
                ),
              },
            ],
            structuredContent: {
              workspaceId,
              topic,
              status: "deferred_phase12",
              draftCreated: false,
              draft: null,
            },
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : "Invalid MCP draft input";
          return toolContent(message);
        }
      default:
        return toolContent(`Unsupported MCP tool: ${name}`);
    }
  }
}
