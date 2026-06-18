import { Injectable } from "@nestjs/common";
import type {
  ActionDraftListRow,
  KnowledgeGapListRow,
  PrismaClient,
} from "@townbase/database";

import {
  createPrismaClient,
  DEFAULT_WORKSPACE_NAME,
  listActionDrafts,
  type KnowledgeGapListFilter,
  listKnowledgeGaps,
  persistActionDraft,
  updateKnowledgeGapStatus,
} from "@townbase/database";
import type { PromptTraceSource } from "@townbase/agent-core";

import {
  generateDraftCandidate,
  type DraftGenerationCandidate,
  type DraftGenerationType,
} from "./draft-generator";

export type GapStatus = "open" | "drafted" | "resolved" | "ignored";

export type DraftCreationResult = Readonly<
  DraftGenerationCandidate & {
    workspaceId: string;
    knowledgeGapId: string;
    draft: ActionDraftListRow;
  }
>;

export type DraftListResult = Readonly<{
  workspaceId: string;
  knowledgeGapId: string;
  drafts: readonly ActionDraftListRow[];
}>;

export type DraftReadResult = Readonly<{
  workspaceId: string;
  knowledgeGapId: string;
  draft: ActionDraftListRow;
}>;

@Injectable()
export class KnowledgeGapsService {
  public constructor(
    private readonly prisma: PrismaClient = createPrismaClient(),
  ) {}

  private async getWorkspaceId(): Promise<string> {
    const workspace = await this.prisma.workspace.findUniqueOrThrow({
      where: {
        name: DEFAULT_WORKSPACE_NAME,
      },
      select: {
        id: true,
      },
    });

    return workspace.id;
  }

  public async list(
    filter: Omit<KnowledgeGapListFilter, "workspaceId">,
    workspaceId?: string,
  ): Promise<readonly KnowledgeGapListRow[]> {
    const resolvedWorkspaceId = workspaceId ?? (await this.getWorkspaceId());

    return listKnowledgeGaps(this.prisma, {
      workspaceId: resolvedWorkspaceId,
      ...filter,
    });
  }

  public async updateStatus(
    knowledgeGapId: string,
    status: GapStatus,
    workspaceId?: string,
  ): Promise<KnowledgeGapListRow> {
    const resolvedWorkspaceId = workspaceId ?? (await this.getWorkspaceId());

    return updateKnowledgeGapStatus(this.prisma, {
      workspaceId: resolvedWorkspaceId,
      knowledgeGapId,
      status,
    });
  }

  public async listDrafts(
    knowledgeGapId: string,
    workspaceId?: string,
  ): Promise<DraftListResult> {
    const resolvedWorkspaceId = workspaceId ?? (await this.getWorkspaceId());
    const drafts = await listActionDrafts(this.prisma, {
      workspaceId: resolvedWorkspaceId,
      knowledgeGapId,
    });

    return {
      workspaceId: resolvedWorkspaceId,
      knowledgeGapId,
      drafts,
    };
  }

  public async getDraft(
    knowledgeGapId: string,
    draftId: string,
    workspaceId?: string,
  ): Promise<DraftReadResult> {
    const resolvedWorkspaceId = workspaceId ?? (await this.getWorkspaceId());
    const draft = await this.prisma.actionDraft.findFirstOrThrow({
      where: {
        workspaceId: resolvedWorkspaceId,
        knowledgeGapId,
        id: draftId,
      },
    });

    return {
      workspaceId: resolvedWorkspaceId,
      knowledgeGapId,
      draft,
    };
  }

  public async createDraft(
    knowledgeGapId: string,
    type: DraftGenerationType,
    workspaceId?: string,
  ): Promise<DraftCreationResult> {
    const resolvedWorkspaceId = workspaceId ?? (await this.getWorkspaceId());
    const gap = await this.prisma.knowledgeGap.findUniqueOrThrow({
      where: {
        workspaceId_id: {
          workspaceId: resolvedWorkspaceId,
          id: knowledgeGapId,
        },
      },
      include: {
        question: {
          include: {
            questionSources: {
              orderBy: {
                rank: "asc",
              },
              include: {
                chunk: {
                  include: {
                    document: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    const sources = gap.question.questionSources.map((source) =>
      toPromptTraceSource(source),
    );
    const candidate = generateDraftCandidate({
      gap: {
        id: gap.id,
        workspaceId: gap.workspaceId,
        questionId: gap.questionId,
        category: gap.category,
        title: gap.title,
        description: gap.description,
        suggestedDocumentTitle: gap.suggestedDocumentTitle,
        suggestedMarkdownPath: gap.suggestedMarkdownPath,
        suggestedGithubIssueTitle: gap.suggestedGithubIssueTitle,
        priority: gap.priority,
        status: gap.status,
        similarQuestionCount: gap.similarQuestionCount,
        relatedMode: gap.relatedMode,
        createdAt: gap.createdAt,
        updatedAt: gap.updatedAt,
      },
      type,
      sources,
    });
    const draft = await persistActionDraft(this.prisma, {
      workspaceId: resolvedWorkspaceId,
      knowledgeGapId: gap.id,
      type: candidate.persistedType,
      title: candidate.title,
      body: candidate.body,
    });

    return {
      ...candidate,
      workspaceId: resolvedWorkspaceId,
      knowledgeGapId: gap.id,
      draft,
    };
  }
}

type QuestionSourceWithChunk = Readonly<{
  rank: number;
  score: number;
  chunk: Readonly<{
    documentId: string;
    id: string;
    sourceType: string;
    sectionTitle: string | null;
    headingPath: unknown;
    document: Readonly<{
      title: string;
      filePath: string | null;
      url: string | null;
    }>;
  }>;
}>;

const toPromptTraceSource = (source: QuestionSourceWithChunk): PromptTraceSource => ({
  documentId: source.chunk.documentId,
  chunkId: source.chunk.id,
  sourceType: source.chunk.sourceType,
  title: source.chunk.document.title,
  filePath: source.chunk.document.filePath,
  sourceUrl: source.chunk.document.url,
  sectionTitle: source.chunk.sectionTitle ?? null,
  headingPath: Array.isArray(source.chunk.headingPath)
    ? source.chunk.headingPath.map((value: unknown) => String(value))
    : [],
  rank: source.rank,
  score: source.score,
});
