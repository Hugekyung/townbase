import { Injectable } from "@nestjs/common";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import type { RetrievalMode } from "@townbase/database";

import { CHAT_MCP_TOOLS } from "./chat.constants";
import { parseChatQuestionInput, resolveChatQuestionSelection } from "./chat-contract";
import { ChatQuestionService } from "./chat.service";
import { KnowledgeGapsService, type GapStatus } from "../knowledge-gaps/knowledge-gaps.service";

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

const readOptionalString = (
  value: Readonly<Record<string, unknown>> | undefined,
  key: string,
): string | undefined => {
  const rawValue = value?.[key];

  if (rawValue === undefined) {
    return undefined;
  }

  if (typeof rawValue !== "string") {
    throw new Error(`${key} must be a non-empty string`);
  }

  const trimmedValue = rawValue.trim();

  if (trimmedValue.length === 0) {
    throw new Error(`${key} must be a non-empty string`);
  }

  return trimmedValue;
};

const readOptionalMode = (
  value: Readonly<Record<string, unknown>> | undefined,
): RetrievalMode | undefined => {
  const mode = readOptionalString(value, "mode");

  if (
    mode !== undefined &&
    !["auto", "onboarding", "product_history", "documentation_gap", "change_impact"].includes(mode)
  ) {
    throw new Error("mode must be one of the supported retrieval modes");
  }

  return mode as RetrievalMode;
};

const readOptionalStatus = (
  value: Readonly<Record<string, unknown>> | undefined,
): GapStatus | undefined => {
  const status = readOptionalString(value, "status");

  if (status !== undefined && !["open", "drafted", "resolved", "ignored"].includes(status)) {
    throw new Error("status must be one of the supported gap statuses");
  }

  return status as GapStatus | undefined;
};

const serialize = (payload: Readonly<Record<string, unknown>>): CallToolResult => ({
  content: [
    {
      type: "text",
      text: JSON.stringify(payload, null, 2),
    },
  ],
  structuredContent: payload,
});

@Injectable()
export class ChatToolRegistry {
  public constructor(
    private readonly questionService: ChatQuestionService,
    private readonly knowledgeGapsService: KnowledgeGapsService,
  ) {}

  public listTools(): readonly Tool[] {
    return [CHAT_MCP_TOOLS.question, CHAT_MCP_TOOLS.knowledgeGap, CHAT_MCP_TOOLS.draft];
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

          return serialize({
            requestedMode: selection.requestedMode,
            resolvedMode: selection.resolvedMode,
            strategy: selection.strategy.mode,
            result,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Invalid MCP question input";
          return toolContent(message);
        }
      case CHAT_MCP_TOOLS.knowledgeGap.name:
        try {
          const workspaceId = readRequiredString(arguments_, "workspaceId");
          const action = readOptionalString(arguments_, "action") ?? "query";

          if (action === "update_status") {
            const knowledgeGapId = readRequiredString(arguments_, "knowledgeGapId");
            const status = readOptionalStatus(arguments_);

            if (status === undefined) {
              throw new Error("status must be a non-empty string");
            }

            const gap = await this.knowledgeGapsService.updateStatus(knowledgeGapId, status, workspaceId);

            return serialize({
              workspaceId,
              action,
              status: "ok",
              gap,
            });
          }

          const query = readOptionalString(arguments_, "query");
          const mode = readOptionalMode(arguments_);
          const category = readOptionalString(arguments_, "category");
          const status = readOptionalStatus(arguments_);
          const gaps = await this.knowledgeGapsService.list(
            {
              ...(mode === undefined ? {} : { mode }),
              ...(category === undefined ? {} : { category }),
              ...(status === undefined ? {} : { status }),
            },
            workspaceId,
          );
          const filteredGaps =
            query === undefined
              ? gaps
              : gaps.filter((gap) => {
                  const haystack = [
                    gap.title,
                    gap.category,
                    gap.description ?? "",
                    gap.suggestedDocumentTitle,
                    gap.suggestedMarkdownPath,
                    gap.suggestedGithubIssueTitle,
                  ]
                    .join(" ")
                    .toLowerCase();

                  return haystack.includes(query.toLowerCase());
                });

          return serialize({
            workspaceId,
            action,
            query: query ?? null,
            filters: {
              ...(mode === undefined ? {} : { mode }),
              ...(category === undefined ? {} : { category }),
              ...(status === undefined ? {} : { status }),
            },
            gaps: filteredGaps,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Invalid MCP knowledge-gap input";
          return toolContent(message);
        }
      case CHAT_MCP_TOOLS.draft.name:
        try {
          const workspaceId = readRequiredString(arguments_, "workspaceId");
          const topic = readRequiredString(arguments_, "topic");

          return serialize({
            workspaceId,
            topic,
            status: "deferred_phase12",
            draftCreated: false,
            draft: null,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Invalid MCP draft input";
          return toolContent(message);
        }
      default:
        return toolContent(`Unsupported MCP tool: ${name}`);
    }
  }
}
