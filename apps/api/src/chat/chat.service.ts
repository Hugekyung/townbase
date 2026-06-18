import {
  buildCitations,
  buildPromptContext,
  COMMON_SYSTEM_PROMPT,
  SOURCE_GROUNDED_ANSWER_RULE,
  type PromptContext,
  type PromptTraceSource,
  resolvePromptTemplate,
  summarizeTraceSources,
} from "@townbase/agent-core";

import type { ChatQuestionInput, ChatQuestionSelection } from "./chat-contract";
import { parseChatQuestionInput, resolveChatQuestionSelection } from "./chat-contract";
import { shouldCreateKnowledgeGap } from "../knowledge-gaps/knowledge-gap-rules";
import type { ChatMcpSurface } from "./chat.server";
import { parseChatQuestionResponse, scoreQuestionConfidence } from "./chat.utils";
import { createDefaultChatDependencies, type ChatExecutionDependencies } from "./chat.runtime";

export type ChatQuestionExecutionResult = Readonly<{
  questionId: string;
  answer: string;
  requestedMode: ChatQuestionInput["mode"];
  resolvedMode: ChatQuestionSelection["resolvedMode"];
  sources: readonly PromptTraceSource[];
  confidence: number;
  isAnswerable: boolean;
  knowledgeGapCreated: boolean;
  model: string;
  latencyMs: number;
  tokenUsage: Readonly<{
    input: number;
    output: number;
  }>;
}>;

export type ChatQuestionExecutionInput = ChatQuestionInput;

export class ChatQuestionService {
  public constructor(private readonly deps: ChatExecutionDependencies = createDefaultChatDependencies()) {}

  public describeSurface(): ChatMcpSurface {
    return this.deps.transport.describeSurface();
  }

  public async executeQuestion(input: unknown): Promise<ChatQuestionExecutionResult> {
    const parsedInput = parseChatQuestionInput(input);
    const selection = resolveChatQuestionSelection(parsedInput);
    const startedAt = Date.now();
    const questionEmbedding = await this.deps.embedding.embedText(parsedInput.question);
    const sources = await this.deps.retriever.retrieve({
      workspaceId: parsedInput.workspaceId,
      question: parsedInput.question,
      requestedMode: selection.requestedMode,
      resolvedMode: selection.resolvedMode,
      strategy: selection.strategy,
      embedding: questionEmbedding,
    });
    const context: PromptContext = buildPromptContext({
      question: parsedInput.question,
      requestedMode: selection.resolvedMode,
      resolvedMode: selection.resolvedMode,
      sources,
    });
    const promptTemplate = resolvePromptTemplate(selection.resolvedMode, sources.length);
    const responseText = await this.deps.completion.complete({
      systemPrompt: [COMMON_SYSTEM_PROMPT, SOURCE_GROUNDED_ANSWER_RULE].join(" "),
      promptTemplate,
      context,
      citations: buildCitations(sources),
      sourceSummary: summarizeTraceSources(sources),
    });
    const parsedResponse = parseChatQuestionResponse(responseText, sources.length);
    const confidence = scoreQuestionConfidence({
      parsedConfidence: parsedResponse.confidence,
      sourceCount: sources.length,
      topScore: sources[0]?.score ?? 0,
      isAnswerable: parsedResponse.isAnswerable,
    });
    const knowledgeGapCreated = shouldCreateKnowledgeGap({
      questionId: "pending",
      question: parsedInput.question,
      requestedMode: parsedInput.mode,
      resolvedMode: selection.resolvedMode,
      confidence,
      isAnswerable: parsedResponse.isAnswerable,
      knowledgeGap: parsedResponse.knowledgeGap,
      sources,
    });
    const questionRecord = await this.deps.prisma.question.create({
      data: {
        workspaceId: parsedInput.workspaceId,
        question: parsedInput.question,
        answer: parsedResponse.isAnswerable ? parsedResponse.answer : null,
        requestedMode: parsedInput.mode,
        resolvedMode: selection.resolvedMode,
        confidence,
        isAnswerable: parsedResponse.isAnswerable,
      },
    });

    await this.deps.persistence.persistQuestionTrace({
      workspaceId: parsedInput.workspaceId,
      questionId: questionRecord.id,
      requestedMode: parsedInput.mode,
      resolvedMode: selection.resolvedMode,
      confidence,
      isAnswerable: parsedResponse.isAnswerable,
      sources,
    });

    return {
      questionId: questionRecord.id,
      answer: parsedResponse.answer,
      requestedMode: parsedInput.mode,
      resolvedMode: selection.resolvedMode,
      sources,
      confidence,
      isAnswerable: parsedResponse.isAnswerable,
      knowledgeGapCreated,
      model: this.deps.completion.model,
      latencyMs: Date.now() - startedAt,
      tokenUsage: parsedResponse.tokenUsage,
    };
  }
}
