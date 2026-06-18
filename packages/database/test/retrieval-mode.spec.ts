import type { RetrievalMode } from "@prisma/client";

import { persistQuestionRetrievalSelection } from "../src/retrieval-mode";

describe("retrieval mode persistence", () => {
  it("persists question traceability and replaces the selected question sources", async () => {
    const update = jest.fn(async () => undefined);
    const deleteMany = jest.fn(async () => undefined);
    const createMany = jest.fn(async () => undefined);

    const prisma = {
      async $transaction<T>(
        callback: (transactionClient: {
          readonly question: {
            update: (input: unknown) => Promise<unknown>;
          };
          readonly questionSource: {
            deleteMany: (input: unknown) => Promise<unknown>;
            createMany: (input: unknown) => Promise<unknown>;
          };
        }) => Promise<T>,
      ): Promise<T> {
        return callback({
          question: {
            update,
          },
          questionSource: {
            deleteMany,
            createMany,
          },
        });
      },
    } as unknown as Parameters<typeof persistQuestionRetrievalSelection>[0];

    await persistQuestionRetrievalSelection(prisma, {
      workspaceId: "workspace-1",
      questionId: "question-1",
      requestedMode: "auto",
      resolvedMode: "onboarding",
      confidence: 0.92,
      isAnswerable: true,
      sources: [
        {
          chunkId: "chunk-1",
          mode: "onboarding" satisfies RetrievalMode,
          rank: 1,
          score: 0.94,
        },
        {
          chunkId: "chunk-2",
          mode: "onboarding" satisfies RetrievalMode,
          rank: 2,
          score: 0.81,
        },
      ],
    });

    expect(update).toHaveBeenCalledWith({
      where: {
        workspaceId_id: {
          workspaceId: "workspace-1",
          id: "question-1",
        },
      },
      data: {
        requestedMode: "auto",
        resolvedMode: "onboarding",
        confidence: 0.92,
        isAnswerable: true,
      },
    });
    expect(deleteMany).toHaveBeenCalledWith({
      where: {
        workspaceId: "workspace-1",
        questionId: "question-1",
      },
    });
    expect(createMany).toHaveBeenCalledWith({
      data: [
        {
          workspaceId: "workspace-1",
          questionId: "question-1",
          chunkId: "chunk-1",
          mode: "onboarding",
          rank: 1,
          score: 0.94,
        },
        {
          workspaceId: "workspace-1",
          questionId: "question-1",
          chunkId: "chunk-2",
          mode: "onboarding",
          rank: 2,
          score: 0.81,
        },
      ],
    });
  });
});
