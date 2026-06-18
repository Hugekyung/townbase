import type { Prisma, PrismaClient, RetrievalMode } from "@prisma/client";

export type { RetrievalMode };

export type PersistQuestionRetrievalSelectionSourceInput = Readonly<{
  chunkId: string;
  mode: RetrievalMode;
  rank: number;
  score: number;
}>;

export type PersistQuestionRetrievalSelectionInput = Readonly<{
  workspaceId: string;
  questionId: string;
  requestedMode: RetrievalMode;
  resolvedMode: RetrievalMode;
  confidence: number;
  isAnswerable: boolean;
  sources: readonly PersistQuestionRetrievalSelectionSourceInput[];
}>;

type QuestionTraceClient = Readonly<{
  $transaction: PrismaClient["$transaction"];
}>;

const createSourceRows = (
  workspaceId: string,
  questionId: string,
  sources: readonly PersistQuestionRetrievalSelectionSourceInput[],
): Prisma.QuestionSourceCreateManyInput[] =>
  sources.map((source) => ({
    workspaceId,
    questionId,
    chunkId: source.chunkId,
    mode: source.mode,
    rank: source.rank,
    score: source.score,
  }));

export const persistQuestionRetrievalSelection = async (
  prisma: QuestionTraceClient,
  input: PersistQuestionRetrievalSelectionInput,
): Promise<void> => {
  await prisma.$transaction(async (transactionClient: Prisma.TransactionClient) => {
    await transactionClient.question.update({
      where: {
        workspaceId_id: {
          workspaceId: input.workspaceId,
          id: input.questionId,
        },
      },
      data: {
        requestedMode: input.requestedMode,
        resolvedMode: input.resolvedMode,
        confidence: input.confidence,
        isAnswerable: input.isAnswerable,
      },
    });

    await transactionClient.questionSource.deleteMany({
      where: {
        workspaceId: input.workspaceId,
        questionId: input.questionId,
      },
    });

    if (input.sources.length === 0) {
      return;
    }

    await transactionClient.questionSource.createMany({
      data: createSourceRows(input.workspaceId, input.questionId, input.sources),
    });
  });
};
