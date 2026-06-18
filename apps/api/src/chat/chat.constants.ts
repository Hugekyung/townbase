import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { CHAT_QUESTION_MODES } from "./chat-contract";

export const CHAT_MCP_SERVER_NAME = "@townbase/api-chat" as const;

export const CHAT_MCP_SERVER_VERSION = "0.1.0" as const;

export const CHAT_MCP_SERVER_GUIDANCE = [
  "Use this server for source-grounded workspace questions.",
  "Answer in Korean unless the user explicitly requests another language.",
  "Prefer explicit mode selection and deterministic retrieval choices.",
  "Do not invent facts that are not supported by the traced sources.",
].join(" ");

const baseToolSchema = {
  type: "object",
  properties: {
    workspaceId: {
      type: "string",
      minLength: 1,
    },
  },
  required: ["workspaceId"],
} as const;

export const CHAT_MCP_TOOLS = {
  question: {
    name: "workspace_knowledge.question",
    description: "Ask a source-grounded workspace question against the local knowledge base.",
    inputSchema: {
      type: "object",
      properties: {
        ...baseToolSchema.properties,
        question: {
          type: "string",
          minLength: 1,
        },
        mode: {
          type: "string",
          enum: [...CHAT_QUESTION_MODES],
        },
      },
      required: ["workspaceId", "question", "mode"],
    },
  } satisfies Tool,
  knowledgeGap: {
    name: "workspace_knowledge.knowledge_gap",
    description: "Inspect the current knowledge-gap surface for a workspace.",
    inputSchema: {
      type: "object",
      properties: {
        ...baseToolSchema.properties,
        action: {
          type: "string",
          enum: ["query", "update_status"],
        },
        query: {
          type: "string",
          minLength: 1,
        },
        knowledgeGapId: {
          type: "string",
          minLength: 1,
        },
        status: {
          type: "string",
          enum: ["open", "drafted", "resolved", "ignored"],
        },
        mode: {
          type: "string",
          enum: ["auto", "onboarding", "product_history", "documentation_gap", "change_impact"],
        },
        category: {
          type: "string",
          minLength: 1,
        },
      },
      required: ["workspaceId"],
    },
  } satisfies Tool,
  draft: {
    name: "workspace_knowledge.draft",
    description: "Generate a draft from the current knowledge base state.",
    inputSchema: {
      type: "object",
      properties: {
        ...baseToolSchema.properties,
        topic: {
          type: "string",
          minLength: 1,
        },
      },
      required: ["workspaceId", "topic"],
    },
  } satisfies Tool,
} as const;
