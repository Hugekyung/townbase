import type { GapPriority, GapStatus, Prisma, RetrievalMode } from "@prisma/client";

export type KnowledgeGapListRow = Readonly<{
  id: string;
  workspaceId: string;
  questionId: string;
  category: string;
  title: string;
  description: string | null;
  suggestedDocumentTitle: string;
  suggestedMarkdownPath: string;
  suggestedGithubIssueTitle: string;
  priority: GapPriority;
  status: GapStatus;
  similarQuestionCount: number;
  relatedMode: RetrievalMode;
  createdAt: Date;
  updatedAt: Date;
}>;

export type KnowledgeGapListFilter = Readonly<{
  workspaceId: string;
  mode?: RetrievalMode;
  category?: string;
  status?: GapStatus;
}>;

export type KnowledgeGapStatusUpdateInput = Readonly<{
  workspaceId: string;
  knowledgeGapId: string;
  status: GapStatus;
}>;

export type KnowledgeGapPersistInput = Readonly<{
  workspaceId: string;
  questionId: string;
  category: string;
  title: string;
  description: string | null;
  suggestedDocumentTitle: string;
  suggestedMarkdownPath: string;
  suggestedGithubIssueTitle: string;
  priority: GapPriority;
  similarQuestionCount: number;
  relatedMode: RetrievalMode;
}>;

export type KnowledgeGapQueryClient = Readonly<{
  knowledgeGap: Readonly<{
    findMany: (args: {
      where: Prisma.KnowledgeGapWhereInput;
      orderBy: Prisma.KnowledgeGapOrderByWithRelationInput;
    }) => Promise<readonly KnowledgeGapListRow[]>;
    update: (args: {
      where: Prisma.KnowledgeGapWhereUniqueInput;
      data: Prisma.KnowledgeGapUpdateInput;
    }) => Promise<KnowledgeGapListRow>;
  }>;
}>;

export const buildKnowledgeGapWhere = (
  filter: KnowledgeGapListFilter,
): Prisma.KnowledgeGapWhereInput => {
  const where: Prisma.KnowledgeGapWhereInput = {
    workspaceId: filter.workspaceId,
  };

  if (filter.mode !== undefined) {
    where.relatedMode = filter.mode;
  }

  if (filter.category !== undefined) {
    where.category = filter.category;
  }

  if (filter.status !== undefined) {
    where.status = filter.status;
  }

  return where;
};

export const listKnowledgeGaps = async (
  client: KnowledgeGapQueryClient,
  filter: KnowledgeGapListFilter,
): Promise<readonly KnowledgeGapListRow[]> =>
  client.knowledgeGap.findMany({
    where: buildKnowledgeGapWhere(filter),
    orderBy: {
      updatedAt: "desc",
    },
  });

export const updateKnowledgeGapStatus = async (
  client: KnowledgeGapQueryClient,
  input: KnowledgeGapStatusUpdateInput,
): Promise<KnowledgeGapListRow> =>
  client.knowledgeGap.update({
    where: {
      workspaceId_id: {
        workspaceId: input.workspaceId,
        id: input.knowledgeGapId,
      },
    },
    data: {
      status: input.status,
    },
  });

export const persistKnowledgeGapCandidate = async (
  client: Readonly<{
    knowledgeGap: Readonly<{
      upsert: (args: {
        where: Prisma.KnowledgeGapWhereUniqueInput;
        create: Prisma.KnowledgeGapUncheckedCreateInput;
        update: Prisma.KnowledgeGapUpdateInput;
      }) => Promise<KnowledgeGapListRow>;
    }>;
  }>,
  input: KnowledgeGapPersistInput,
): Promise<KnowledgeGapListRow> =>
  client.knowledgeGap.upsert({
    where: {
      workspaceId_questionId: {
        workspaceId: input.workspaceId,
        questionId: input.questionId,
      },
    },
    create: {
      workspaceId: input.workspaceId,
      questionId: input.questionId,
      category: input.category,
      title: input.title,
      description: input.description,
      suggestedDocumentTitle: input.suggestedDocumentTitle,
      suggestedMarkdownPath: input.suggestedMarkdownPath,
      suggestedGithubIssueTitle: input.suggestedGithubIssueTitle,
      priority: input.priority,
      similarQuestionCount: input.similarQuestionCount,
      relatedMode: input.relatedMode,
    },
    update: {
      category: input.category,
      title: input.title,
      description: input.description,
      suggestedDocumentTitle: input.suggestedDocumentTitle,
      suggestedMarkdownPath: input.suggestedMarkdownPath,
      suggestedGithubIssueTitle: input.suggestedGithubIssueTitle,
      priority: input.priority,
      similarQuestionCount: input.similarQuestionCount,
      relatedMode: input.relatedMode,
    },
  });
