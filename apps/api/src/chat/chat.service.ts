import {
  buildCitations,
  buildPromptContext,
  COMMON_SYSTEM_PROMPT,
  SOURCE_GROUNDED_ANSWER_RULE,
  type PromptTraceSource,
  resolvePromptTemplate,
  summarizeTraceSources,
} from "@townbase/agent-core";

import type { ChatQuestionInput, ChatQuestionSelection } from "./chat-contract";
import { parseChatQuestionInput, resolveChatQuestionSelection } from "./chat-contract";
import { deriveKnowledgeGapCandidate } from "../knowledge-gaps/knowledge-gap-rules";
import type { ChatMcpSurface } from "./chat.server";
import { ANSWERABILITY_CONFIG } from "./chat.constants";
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

type ResolvedChatQuestionInput = ChatQuestionInput & Readonly<{
  workspaceId: string;
}>;

const isRetrievalAnswerable = (sources: readonly PromptTraceSource[]): boolean => {
  if (sources.length === 0) {
    return false;
  }

  const topScore = sources[0]?.score ?? 0;
  const topThree = sources.slice(0, 3);
  const averageTopThreeScore = topThree.reduce((total, source) => total + source.score, 0) / topThree.length;

  return (
    topScore >= ANSWERABILITY_CONFIG.minimumTopScore &&
    averageTopThreeScore >= ANSWERABILITY_CONFIG.minimumAverageTopThreeScore
  );
};

export class ChatQuestionService {
  public constructor(private readonly deps: ChatExecutionDependencies = createDefaultChatDependencies()) {}

  public describeSurface(): ChatMcpSurface {
    return this.deps.transport.describeSurface();
  }

  public async executeQuestion(input: unknown): Promise<ChatQuestionExecutionResult> {
    const parsedInputWithoutWorkspace = parseChatQuestionInput(input);
    const defaultWorkspaceId = parsedInputWithoutWorkspace.workspaceId === undefined
      ? await this.deps.workspace?.resolveDefaultWorkspaceId()
      : undefined;
    const workspaceId = parsedInputWithoutWorkspace.workspaceId ?? defaultWorkspaceId;
    if (workspaceId === undefined) {
      throw new Error("A default workspace is required when workspaceId is omitted");
    }
    const parsedInput: ResolvedChatQuestionInput = {
      ...parsedInputWithoutWorkspace,
      workspaceId,
    };
    const selection = resolveChatQuestionSelection(parsedInput);
    const startedAt = Date.now();
    const questionEmbedding = await this.deps.embedding.embedText(parsedInput.question);
    const sources = await this.deps.retriever.retrieve({
      workspaceId: parsedInput.workspaceId,
      question: parsedInput.question,
      requestedMode: selection.requestedMode,
      resolvedMode: selection.resolvedMode,
      strategy: selection.strategy,
      executionStrategy: this.deps.retrievalExecutionStrategy,
      embedding: questionEmbedding,
    });
    const answerable = isRetrievalAnswerable(sources);
    const answerSources = answerable ? sources : [];
    const parsedResponse = answerable
      ? parseChatQuestionResponse(
          await this.deps.completion.complete({
            systemPrompt: [COMMON_SYSTEM_PROMPT, SOURCE_GROUNDED_ANSWER_RULE].join(" "),
            promptTemplate: resolvePromptTemplate(selection.resolvedMode, sources.length),
            context: buildPromptContext({
              question: parsedInput.question,
              requestedMode: selection.resolvedMode,
              resolvedMode: selection.resolvedMode,
              sources,
            }),
            citations: buildCitations(sources),
            sourceSummary: summarizeTraceSources(sources),
          }),
          sources.length,
        )
      : {
          answer: "",
          isAnswerable: false,
          confidence: 0,
          knowledgeGap: null,
          suggestedFollowups: [],
          tokenUsage: { input: 0, output: 0 },
        };
    const confidence = scoreQuestionConfidence({
      parsedConfidence: parsedResponse.confidence,
      sourceCount: sources.length,
      topScore: sources[0]?.score ?? 0,
      isAnswerable: answerable,
    });
    const questionRecord = await this.deps.prisma.question.create({
      data: {
        workspaceId: parsedInput.workspaceId,
        question: parsedInput.question,
        answer: answerable ? parsedResponse.answer : null,
        requestedMode: parsedInput.mode,
        resolvedMode: selection.resolvedMode,
        confidence,
        isAnswerable: answerable,
      },
    });

    await this.deps.persistence.persistQuestionTrace({
      workspaceId: parsedInput.workspaceId,
      questionId: questionRecord.id,
      requestedMode: parsedInput.mode,
      resolvedMode: selection.resolvedMode,
      confidence,
      isAnswerable: answerable,
      sources: answerSources,
    });

    const knowledgeGapCandidate = deriveKnowledgeGapCandidate({
      questionId: questionRecord.id,
      question: parsedInput.question,
      requestedMode: parsedInput.mode,
      resolvedMode: selection.resolvedMode,
      confidence,
      isAnswerable: answerable,
      knowledgeGap: parsedResponse.knowledgeGap,
      sources: answerSources,
    });

    if (knowledgeGapCandidate !== null) {
      await this.deps.knowledgeGapPersistence.persistKnowledgeGapCandidate({
        workspaceId: parsedInput.workspaceId,
        category: knowledgeGapCandidate.category,
        title: knowledgeGapCandidate.title,
        description: knowledgeGapCandidate.description,
        suggestedDocumentTitle: knowledgeGapCandidate.suggestedDocumentTitle,
        suggestedMarkdownPath: knowledgeGapCandidate.suggestedMarkdownPath,
        suggestedGithubIssueTitle: knowledgeGapCandidate.suggestedGithubIssueTitle,
        priority: knowledgeGapCandidate.priority,
        relatedMode: knowledgeGapCandidate.relatedMode,
        similarQuestionCount: knowledgeGapCandidate.similarQuestionCount,
        questionId: knowledgeGapCandidate.questionId,
      });
    }

    return {
      questionId: questionRecord.id,
      answer: answerable ? parsedResponse.answer : "",
      requestedMode: parsedInput.mode,
      resolvedMode: selection.resolvedMode,
      sources: answerSources,
      confidence,
      isAnswerable: answerable,
      knowledgeGapCreated: knowledgeGapCandidate !== null,
      model: this.deps.completion.model,
      latencyMs: Date.now() - startedAt,
      tokenUsage: parsedResponse.tokenUsage,
    };
  }
}
