import type { ActionDraftStatus, ActionDraftType, Prisma, PrismaClient } from "@prisma/client";

export type ActionDraftListRow = Readonly<{
  id: string;
  workspaceId: string;
  knowledgeGapId: string;
  type: ActionDraftType;
  title: string;
  body: string;
  status: ActionDraftStatus;
  createdAt: Date;
  updatedAt: Date;
}>;

export type ActionDraftListFilter = Readonly<{
  workspaceId: string;
  knowledgeGapId?: string;
  type?: ActionDraftType;
  status?: ActionDraftStatus;
}>;

export type ActionDraftPersistInput = Readonly<{
  workspaceId: string;
  knowledgeGapId: string;
  type: ActionDraftType;
  title: string;
  body: string;
  status?: ActionDraftStatus;
}>;

export type ActionDraftStatusUpdateInput = Readonly<{
  workspaceId: string;
  actionDraftId: string;
  status: ActionDraftStatus;
}>;

export type ActionDraftQueryClient = Readonly<{
  actionDraft: Readonly<{
    findMany: (args: {
      where: Prisma.ActionDraftWhereInput;
      orderBy: Prisma.ActionDraftOrderByWithRelationInput;
    }) => Promise<readonly ActionDraftListRow[]>;
    upsert: (args: {
      where: Prisma.ActionDraftWhereUniqueInput;
      create: Prisma.ActionDraftUncheckedCreateInput;
      update: Prisma.ActionDraftUpdateInput;
    }) => Promise<ActionDraftListRow>;
    updateMany: (args: {
      where: Prisma.ActionDraftWhereInput;
      data: Prisma.ActionDraftUpdateManyMutationInput;
    }) => Promise<{ count: number }>;
    findFirstOrThrow: (args: {
      where: Prisma.ActionDraftWhereInput;
    }) => Promise<ActionDraftListRow>;
  }>;
  $transaction: PrismaClient["$transaction"];
}>;

export const buildActionDraftWhere = (filter: ActionDraftListFilter): Prisma.ActionDraftWhereInput => {
  const where: Prisma.ActionDraftWhereInput = {
    workspaceId: filter.workspaceId,
  };

  if (filter.knowledgeGapId !== undefined) {
    where.knowledgeGapId = filter.knowledgeGapId;
  }

  if (filter.type !== undefined) {
    where.type = filter.type;
  }

  if (filter.status !== undefined) {
    where.status = filter.status;
  }

  return where;
};

export const listActionDrafts = async (
  client: Pick<ActionDraftQueryClient, "actionDraft">,
  filter: ActionDraftListFilter,
): Promise<readonly ActionDraftListRow[]> =>
  client.actionDraft.findMany({
    where: buildActionDraftWhere(filter),
    orderBy: {
      updatedAt: "desc",
    },
  });

export const persistActionDraft = async (
  client: ActionDraftQueryClient,
  input: ActionDraftPersistInput,
): Promise<ActionDraftListRow> =>
  client.actionDraft.upsert({
    where: {
      workspaceId_knowledgeGapId_type: {
        workspaceId: input.workspaceId,
        knowledgeGapId: input.knowledgeGapId,
        type: input.type,
      },
    },
    create: {
      workspaceId: input.workspaceId,
      knowledgeGapId: input.knowledgeGapId,
      type: input.type,
      title: input.title,
      body: input.body,
      status: input.status ?? "draft",
    },
    update: {
      title: input.title,
      body: input.body,
      status: input.status ?? "draft",
    },
  });

export const updateActionDraftStatus = async (
  client: Pick<ActionDraftQueryClient, "actionDraft">,
  input: ActionDraftStatusUpdateInput,
): Promise<ActionDraftListRow> => {
  const result = await client.actionDraft.updateMany({
    where: {
      workspaceId: input.workspaceId,
      id: input.actionDraftId,
    },
    data: {
      status: input.status,
    },
  });

  if (result.count === 0) {
    throw new Error("ActionDraft not found in workspace");
  }

  return client.actionDraft.findFirstOrThrow({
    where: {
      workspaceId: input.workspaceId,
      id: input.actionDraftId,
    },
  });
};
