import { RagService } from "../src/rag/rag.service";
import type { RagStore, Admission } from "../src/rag/rag-store";
import type { ModelExecutionService } from "../src/model-integration/model-execution.service";
import type { FileIndexService } from "../src/files/file-index.service";
import type { AdministratorContext } from "../src/auth/auth.service";
describe("whole-question deadline", () => {
  test("returns persisted timeout state even if a dependency ignores abort, then rejects late publication", async () => {
    jest.useFakeTimers();
    const requestId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const admission = {
      turn: {
        requestId,
        question: "질문",
        deadlineAt: new Date(Date.now() + 90_000),
      },
      historySources: [],
      config: {
        name: "Agent",
        purpose: "answer",
        instructions: "",
        terminology: [],
      },
    } as unknown as Admission;
    const store = {
      admit: jest.fn().mockResolvedValue({ admission }),
      fail: jest.fn().mockResolvedValue(undefined),
      read: jest
        .fn()
        .mockResolvedValue({
          requestId,
          status: "failed",
          errorCode: "question_timeout",
        }),
      complete: jest.fn(),
    };
    let finish!: (value: unknown) => void;
    const models = {
      execute: jest.fn(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      ),
    };
    const service = new RagService(
      store as unknown as RagStore,
      models as unknown as ModelExecutionService,
      {} as FileIndexService,
    );
    try {
      const result = service.ask("token", {} as AdministratorContext, {
        requestId,
        question: "질문",
        requestedMode: "auto",
      });
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
      finish({ call: { status: "unknown", errorCode: "call_cancelled" } });
      await jest.advanceTimersByTimeAsync(0);
      expect(store.complete).not.toHaveBeenCalled();
      await service.onModuleDestroy();
    } finally {
      jest.useRealTimers();
    }
  });
});
