// Explicit local diagnostic only. No DB, credential, embedding or provider calls.
import { createHash } from "node:crypto";
import { readFile, writeFile, open } from "node:fs/promises";
import { lexicalMatches } from "../files/retrieval-text";
import { selectSources, resolvedMode, type RagSource } from "../rag/rag-policy";
import { BASIC_AGENT_MODES, type BasicAgentMode } from "@townbase/agent-core";
import { savedSources } from "../rag/rag-store";

export async function replayRetrieval(inputPath: string, outputPath: string) {
  if (process.env.NODE_ENV === "production" || inputPath === outputPath)
    throw new Error("local_evaluation_only");
  const handle = await open(inputPath, "r");
  let raw: Buffer;
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 8 * 1024 * 1024)
      throw new Error("fixture_limit");
    const bounded = Buffer.alloc(8 * 1024 * 1024 + 1);
    let used = 0;
    while (used < bounded.length) {
      const { bytesRead } = await handle.read(
        bounded,
        used,
        bounded.length - used,
      );
      if (!bytesRead) break;
      used += bytesRead;
    }
    if (used > 8 * 1024 * 1024) throw new Error("fixture_limit");
    raw = bounded.subarray(0, used);
  } finally {
    await handle.close();
  }
  const fixture = JSON.parse(raw.toString("utf8")) as {
    chunks: RagSource[];
    questions: { question: string; requestedMode?: BasicAgentMode }[];
  };
  if (
    !Array.isArray(fixture.chunks) ||
    fixture.chunks.length > 5000 ||
    !Array.isArray(fixture.questions) ||
    fixture.questions.length > 120
  )
    throw new Error("fixture_limit");
  for (const chunk of fixture.chunks)
    savedSources([chunk] as unknown as Parameters<typeof savedSources>[0]);
  const cases = fixture.questions.map(
    ({ question, requestedMode = "auto" }) => {
      if (!BASIC_AGENT_MODES.includes(requestedMode))
        throw new Error("invalid_mode");
      if (typeof question !== "string" || [...question].length > 4000)
        throw new Error("invalid_question");
      const mode = resolvedMode(requestedMode, question);
      // Deliberately lexical-only: historical query embeddings were not retained.
      // Never report this as live hybrid retrieval or end-to-end answer accuracy.
      const candidates = fixture.chunks
        .map((s) => ({
          ...s,
          score: 0,
          hits: lexicalMatches(question, s.content),
        }))
        .filter((s) => s.hits >= 2)
        .sort((a, b) => b.hits - a.hits || a.id.localeCompare(b.id))
        .slice(0, 20)
        .map((s, i) => ({ ...s, vectorRank: null, lexicalRank: i + 1 }));
      const result = selectSources(mode, candidates, question);
      return {
        requestedMode,
        resolvedMode: mode,
        questionHash: createHash("sha256").update(question).digest("hex"),
        candidateCount: candidates.length,
        selectedCount: result.sources.length,
        evidenceBytes: result.evidenceBytes,
        diagnostics: result.diagnostics,
        sources: result.sources.map((s) => ({
          id: s.id,
          locations: s.locations,
          evidenceWindow: s.evidenceWindow ?? null,
        })),
      };
    },
  );
  const report = {
    version: 1,
    method: "lexical-only-offline-diagnostic",
    liveModelEvaluation: false,
    inputHash: createHash("sha256").update(raw).digest("hex"),
    cases,
  };
  const text = JSON.stringify(report, null, 2) + "\n";
  // Exclusive creation prevents overwriting another report or following symlinks.
  await writeFile(outputPath, text, { mode: 0o600, flag: "wx" });
  if ((await readFile(outputPath, "utf8")) !== text)
    throw new Error("readback_failed");
  return report;
}

const diagnostics = new Set([
  "local_evaluation_only",
  "fixture_limit",
  "invalid_question",
  "invalid_mode",
  "readback_failed",
  "input_and_output_required",
]);
export function replayDiagnostic(error: unknown): string {
  if (error instanceof SyntaxError) return "invalid_json";
  if (error instanceof Error && diagnostics.has(error.message))
    return error.message;
  if (error != null && typeof error === "object" && "code" in error) {
    if (["ENOENT", "EACCES", "EPERM", "EISDIR"].includes(String(error.code)))
      return "file_io_unavailable";
    if (error.code === "EEXIST") return "output_exists";
    if (error.code === "stored_result_unavailable") return "invalid_source";
  }
  return "unexpected_failure";
}
export async function runReplayCli(args: string[]) {
  const [input, output] = args;
  if (!input || !output || args.length !== 2)
    throw new Error("input_and_output_required");
  return replayRetrieval(input, output);
}
if (require.main === module) {
  void runReplayCli(process.argv.slice(2))
    .then((r) =>
      console.log(JSON.stringify({ cases: r.cases.length, method: r.method })),
    )
    .catch((error: unknown) => {
      console.error("RETRIEVAL_REPLAY_FAILED:" + replayDiagnostic(error));
      process.exitCode = 1;
    });
}
