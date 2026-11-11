import { RAG_LIMITS, type RagSource } from "../src/rag/rag-policy";
import { RagService } from "../src/rag/rag.service";
import type { RagStore, Admission } from "../src/rag/rag-store";
import type { ModelExecutionService } from "../src/model-integration/model-execution.service";
import type { FileIndexService } from "../src/files/file-index.service";
import type { AdministratorContext } from "../src/auth/auth.service";

// R07 Q13: the service, not only the policy helper, must select with the room
// the input limit leaves, so a line past the 8KB window reaches the model.
describe("RAG service evidence budget", () => {
  const uid = (n: number) =>
    `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const chunk = (n: number, lines: string[]) =>
    ({
      id: uid(n),
      indexId: uid(n),
      originalId: uid(100 + n),
      versionId: uid(200 + n),
      scopeRevision: 1,
      content: lines.join("\n"),
      title: "공고",
      fileName: "notice.pdf",
      format: "pdf",
      contentHash: "x",
      chunkHash: "x",
      locations: [],
      headingPath: [],
      sourceType: "uploaded_file",
      knowledgeTypes: ["unknown"],
      domainTags: [],
      status: "active",
      sourcePriority: 50,
      requestedMode: null,
      resolvedMode: null,
      score: 0.6 - n / 100,
      vectorRank: n,
      lexicalRank: n,
      reference: "/files/" + uid(100 + n) + "/reference",
    }) as unknown as RagSource;
  const filler = (n: number) =>
    Array.from({ length: 55 }, (_, i) => `일반 안내 문장 ${n}-${i}번입니다.`);
  const exception =
    "* 다만, 아래 경우는 제외\n- 청년계층의 경우 19세이상 39세이하";
  const candidates = [
    chunk(1, filler(1)),
    chunk(2, [
      "갱신계약 때 나이 요건 다시 확인 안내입니다.",
      ...Array.from(
        { length: 34 },
        (_, i) => `거주기간 합산 안내 ${i}번입니다.`,
      ),
      "■ 갱신계약자격",
      ...Array.from(
        { length: 14 },
        (_, i) => `입주자격 유지 안내 ${i}번입니다.`,
      ),
      exception,
    ]),
    ...[3, 4, 5].map((n) => chunk(n, filler(n))),
  ];
  test("the answer prompt carries evidence beyond 8KB within the input limit", async () => {
    const requestId = uid(9);
    const question = "갱신계약 때 나이 요건도 다시 확인해?";
    const admission = {
      turn: {
        requestId,
        question,
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
    const store = {
      admit: jest.fn().mockResolvedValue({ admission }),
      fail: jest.fn().mockResolvedValue(undefined),
      read: jest.fn().mockResolvedValue({ requestId, status: "failed" }),
      complete: jest.fn().mockResolvedValue(undefined),
      recordSources: jest.fn(async (...args: unknown[]) => args[3]),
    };
    const models = {
      execute: jest
        .fn()
        .mockResolvedValueOnce({
          call: { status: "succeeded" },
          result: { embedding: [1] },
        })
        .mockResolvedValueOnce({
          call: { status: "succeeded", model: "gpt-6-luna" },
          result: { text: "not json" },
        }),
    };
    const index = { search: jest.fn().mockResolvedValue(candidates) };
    const service = new RagService(
      store as unknown as RagStore,
      models as unknown as ModelExecutionService,
      index as unknown as FileIndexService,
    );
    try {
      await service.ask("token", {} as AdministratorContext, {
        requestId,
        question,
        requestedMode: "auto",
      });
      expect(models.execute).toHaveBeenCalledTimes(2);
      const call = models.execute.mock.calls[1]![2] as {
        purpose: string;
        input: string;
      };
      expect(call.purpose).toBe("rag_answer");
      const sources = JSON.parse(call.input).sources as Array<{
        content: string;
      }>;
      expect(
        Buffer.byteLength(JSON.stringify(sources), "utf8"),
      ).toBeGreaterThan(RAG_LIMITS.evidenceBytes);
      expect(sources.map((s) => s.content).join("\n")).toContain(exception);
    } finally {
      await service.onModuleDestroy();
    }
  });
});
