import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  replayRetrieval,
  replayDiagnostic,
  runReplayCli,
} from "../src/evaluation/retrieval-replay";
import { BASIC_AGENT_MODES } from "@townbase/agent-core";
import { retrievalTerms } from "../src/files/retrieval-text";

test("lexical terms retain short content words and remove chained particles", () => {
  expect(retrievalTerms("제도 나이 정도 학생에게는 제도는 나이는")).toEqual([
    "제도",
    "나이",
    "정도",
    "학생",
  ]);
  const words = Array.from({ length: 1000 }, (_, i) => `항목${i}`);
  expect(new Set(words).size).toBe(1000);
  expect(retrievalTerms(words.join(" "))).toEqual(words.slice(0, 24));
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
    fixture.questions = BASIC_AGENT_MODES.map((requestedMode) => ({
      question: "결정 배경 알려줘",
      requestedMode,
    }));
    await writeFile(input, JSON.stringify(fixture));
    const modes = await replayRetrieval(input, path.join(dir, "modes.json"));
    expect(modes.cases.map((c) => c.requestedMode)).toEqual([
      ...BASIC_AGENT_MODES,
    ]);
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
  ).toBe("file_io_unavailable");
  expect(replayDiagnostic(new Error("private source text"))).toBe(
    "unexpected_failure",
  );
  expect(replayDiagnostic(new Error("invalid_mode"))).toBe("invalid_mode");
  await expect(runReplayCli([])).rejects.toThrow("input_and_output_required");
});

test("output-directory I/O failures use a neutral code without exposing paths", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "townbase-output-"));
  try {
    const input = path.join(dir, "fixture.json");
    await writeFile(input, JSON.stringify({ chunks: [], questions: [] }));
    let error: unknown;
    try {
      await replayRetrieval(input, path.join(dir, "missing", "output.json"));
    } catch (cause) {
      error = cause;
    }
    expect(error).toMatchObject({ code: "ENOENT" });
    expect(replayDiagnostic(error)).toBe("file_io_unavailable");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
