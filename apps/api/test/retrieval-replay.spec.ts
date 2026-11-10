import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  replayRetrieval,
  replayDiagnostic,
  runReplayCli,
} from "../src/evaluation/retrieval-replay";
import { retrievalTerms } from "../src/files/retrieval-text";

test("lexical terms retain short content words and remove chained particles", () => {
  expect(retrievalTerms("제도 나이 정도 학생에게는 제도는 나이는")).toEqual([
    "제도",
    "나이",
    "정도",
    "학생",
  ]);
  expect(retrievalTerms("긴문장 ".repeat(1000)).length).toBeLessThanOrEqual(24);
});
test("replay records the effective mode and persists a readback without raw source text", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "townbase-replay-"));
  const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    content = "결정 배경: 서비스 변경 이유는 비용입니다.";
  try {
    const fixture = {
      chunks: [
        {
          id,
          indexId: id,
          originalId: id,
          versionId: id,
          scopeRevision: 1,
          content,
          title: "history",
          reference: "/files/fixture",
          locations: [],
          headingPath: [],
          chunkHash: createHash("sha256").update(content).digest("hex"),
          sourceType: "uploaded_file",
          knowledgeTypes: ["product_history"],
          status: "active",
          sourcePriority: 0,
        },
      ],
      questions: [
        { question: "결정 배경 알려줘" },
        { question: "결정 배경 알려줘", requestedMode: "onboarding" },
      ],
    };
    const input = path.join(dir, "input.json"),
      output = path.join(dir, "report.json");
    await writeFile(input, JSON.stringify(fixture));
    const report = await replayRetrieval(input, output);
    expect(report.cases[0]).toMatchObject({
      requestedMode: "auto",
      resolvedMode: "product_history",
      selectedCount: 1,
    });
    expect(report.cases[1]).toMatchObject({
      requestedMode: "onboarding",
      resolvedMode: "onboarding",
      selectedCount: 0,
    });
    expect(JSON.parse(await readFile(output, "utf8"))).toEqual(report);
    expect(await readFile(output, "utf8")).not.toContain(content);
    await expect(replayRetrieval(input, output)).rejects.toMatchObject({
      code: "EEXIST",
    });
    fixture.questions[0] = {
      question: "결정 배경",
      requestedMode: "unsupported",
    };
    await writeFile(input, JSON.stringify(fixture));
    await expect(
      replayRetrieval(input, path.join(dir, "invalid.json")),
    ).rejects.toThrow("invalid_mode");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("diagnostics expose only allowed codes, never arbitrary error text or paths", async () => {
  expect(replayDiagnostic(new SyntaxError("private source text"))).toBe(
    "invalid_json",
  );
  expect(
    replayDiagnostic(
      Object.assign(new Error("/private/secret"), { code: "ENOENT" }),
    ),
  ).toBe("fixture_io_unavailable");
  expect(replayDiagnostic(new Error("private source text"))).toBe(
    "unexpected_failure",
  );
  expect(replayDiagnostic(new Error("invalid_mode"))).toBe("invalid_mode");
  await expect(runReplayCli([])).rejects.toThrow("input_and_output_required");
});
