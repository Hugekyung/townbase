import type { RagSource } from "../src/rag/rag-policy";
import { RagService } from "../src/rag/rag.service";
import type { RagStore, Admission } from "../src/rag/rag-store";
import type { ModelExecutionService } from "../src/model-integration/model-execution.service";
import type { FileIndexService } from "../src/files/file-index.service";
import type { AdministratorContext } from "../src/auth/auth.service";
describe("whole-question deadline", () => {
  test.each([false, true])(
    "valid answer publication with expired=%s even when the provider ignores abort",
    async (expired) => {
      jest.useFakeTimers();
      const requestId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
      const admission = {
        turn: {
          requestId,
          question: "질문",
          resolvedMode: "onboarding",
          deadlineAt: new Date(Date.now() + 90_000),
        },
        historySources: [],
        history: [],
        inputLimit: 16000,
        config: {
          name: "Agent",
          purpose: "answer",
          instructions: "",
          terminology: [],
        },
      } as unknown as Admission;
      const source = {
        id: requestId,
        originalId: requestId,
        content: "문서에 기록된 답변",
        title: "문서",
        sourceType: "uploaded_file",
        knowledgeTypes: ["unknown"],
        domainTags: [],
        status: "active",
        sourcePriority: 50,
        score: 0.9,
        locations: [],
        headingPath: [],
      } as unknown as RagSource;
      const store = {
        admit: jest.fn().mockResolvedValue({ admission }),
        fail: jest.fn().mockResolvedValue(undefined),
        read: jest.fn().mockResolvedValue({
          requestId,
          status: "failed",
          errorCode: "question_timeout",
        }),
        complete: jest.fn().mockResolvedValue(undefined),
        recordSources: jest.fn().mockResolvedValue([source]),
      };
      let finish!: (value: unknown) => void;
      const models = {
        execute: jest
          .fn()
          .mockResolvedValueOnce({
            call: { status: "succeeded" },
            result: { embedding: [1] },
          })
          .mockImplementationOnce(
            () =>
              new Promise((resolve) => {
                finish = resolve;
              }),
          ),
      };
      const index = { search: jest.fn().mockResolvedValue([source]) };
      const service = new RagService(
        store as unknown as RagStore,
        models as unknown as ModelExecutionService,
        index as unknown as FileIndexService,
      );
      try {
        const result = service.ask("token", {} as AdministratorContext, {
          requestId,
          question: "질문",
          requestedMode: "auto",
        });
        await jest.advanceTimersByTimeAsync(0);
        expect(models.execute).toHaveBeenCalledTimes(2);
        expect(models.execute.mock.calls[1]![2]).toMatchObject({
          purpose: "rag_answer",
        });
        expect(index.search).toHaveBeenCalledTimes(1);
        if (expired) {
          await jest.advanceTimersByTimeAsync(90_000);
          await expect(result).resolves.toMatchObject({
            status: "failed",
            errorCode: "question_timeout",
          });
          expect(store.fail).toHaveBeenCalledWith(
            expect.anything(),
            admission.turn,
            "question_timeout",
          );
        }
        finish({
          call: { status: "succeeded", model: "gpt-6-luna" },
          result: {
            text: JSON.stringify({
              isAnswerable: true,
              reason: "",
              conflicts: [],
              claims: [
                {
                  text: "기록된 답변",
                  evidence: [{ sourceId: requestId, quote: "기록된 답변" }],
                },
              ],
            }),
          },
        });
        await jest.advanceTimersByTimeAsync(0);
        await result;
        expect(store.complete).toHaveBeenCalledTimes(expired ? 0 : 1);
        if (!expired) expect(store.fail).not.toHaveBeenCalled();
        await service.onModuleDestroy();
      } finally {
        jest.useRealTimers();
      }
    },
  );
});
