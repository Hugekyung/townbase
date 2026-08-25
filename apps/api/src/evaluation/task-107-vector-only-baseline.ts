import fs from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";

import dotenv from "dotenv";
import {
  createPrismaClient,
  disconnectPrismaClient,
  persistDocumentChunkEmbedding,
  searchDocumentChunksByEmbedding,
} from "@townbase/database";
import {
  createEmbeddingModel,
  embedDocumentChunks,
} from "@townbase/connectors";
import { chunkDocument } from "@townbase/rag-core";

type CorpusDocument = Readonly<{
  path: string;
  sourceType: "repo_readme" | "repo_docs";
  contentHash: string;
}>;

type CorpusManifest = Readonly<{
  workspaceId: string;
  embedding: Readonly<{ model: string; dimensions: number }>;
  chunking: Readonly<{ maxTokens: number; overlapTokens: number }>;
  documents: readonly CorpusDocument[];
}>;

type GoldenQuestion = Readonly<{
  id: string;
  question: string;
  expectedDocumentPaths: readonly string[];
  answerable: boolean;
}>;

type GoldenDataset = Readonly<{ questions: readonly GoldenQuestion[] }>;

type BaselineResult = Readonly<{
  id: string;
  question: string;
  expectedDocumentPaths: readonly string[];
  answerable: boolean;
  latencyMs: number;
  results: readonly Readonly<{
    rank: number;
    score: number;
    documentPath: string | null;
    chunkId: string;
  }>[];
  firstRelevantRank: number | null;
}>;

type EvaluationMetrics = Readonly<{
  label: string;
  maxTokens: number;
  overlapTokens: number;
  chunkCount: number;
  hitAt5: number;
  mrr: number;
}>;

const rootPath = path.resolve(__dirname, "../../../..");
const corpusPath = path.join(rootPath, "fixtures/evaluation/corpus.json");
const goldenPath = path.join(rootPath, "fixtures/evaluation/golden-questions.json");
const reportPath = path.join(rootPath, "docs/evaluation/task-107-vector-only-baseline.md");
const finalReportPath = path.join(rootPath, "docs/evaluation-report.md");

const loadJson = async <T>(filePath: string): Promise<T> =>
  JSON.parse(await fs.readFile(filePath, "utf8")) as T;

const upsertEvaluationWorkspace = async (
  prisma: ReturnType<typeof createPrismaClient>,
  workspaceName: string,
): Promise<Readonly<{ workspaceId: string; dataSourceId: string }>> => {
  const workspace = await prisma.workspace.upsert({
    where: { name: workspaceName },
    update: {},
    create: { name: workspaceName },
  });
  const dataSource = await prisma.dataSource.upsert({
    where: { workspaceId_name: { workspaceId: workspace.id, name: "task-107-evaluation" } },
    update: { type: "local_repo", rootPath: rootPath },
    create: {
      workspaceId: workspace.id,
      type: "local_repo",
      name: "task-107-evaluation",
      rootPath,
    },
  });
  return { workspaceId: workspace.id, dataSourceId: dataSource.id };
};

const indexCorpus = async (
  prisma: ReturnType<typeof createPrismaClient>,
  manifest: CorpusManifest,
  workspaceId: string,
  dataSourceId: string,
  embeddingModel: ReturnType<typeof createEmbeddingModel>,
): Promise<Readonly<{ documentCount: number; chunkCount: number }>> => {
  let chunkCount = 0;
  for (const item of manifest.documents) {
    const content = await fs.readFile(path.join(rootPath, item.path), "utf8");
    const document = await prisma.document.upsert({
      where: { dataSourceId_externalId: { dataSourceId, externalId: item.path } },
      update: {
        sourceType: item.sourceType,
        title: path.basename(item.path),
        filePath: item.path,
        content,
        contentHash: item.contentHash,
        status: "active",
        indexStatus: "pending",
      },
      create: {
        workspaceId,
        dataSourceId,
        externalId: item.path,
        sourceType: item.sourceType,
        title: path.basename(item.path),
        filePath: item.path,
        content,
        contentHash: item.contentHash,
      },
    });
    await prisma.documentChunk.deleteMany({ where: { documentId: document.id } });
    const chunks = chunkDocument(
      {
        documentId: document.id,
        sourceType: item.sourceType,
        content,
        sectionTitle: null,
        headingPath: [],
        contentHash: item.contentHash,
        knowledgeTypes: [],
        domainTags: ["task-107-evaluation"],
        metadata: { evaluationCorpusPath: item.path },
        status: "active",
        sourcePriority: 1,
        requestedMode: "auto",
        resolvedMode: null,
      },
      manifest.chunking,
    );
    await prisma.documentChunk.createMany({
      data: chunks.map((chunk) => ({
        id: chunk.chunkId,
        workspaceId,
        documentId: document.id,
        content: chunk.content,
        sourceType: item.sourceType,
        chunkType: chunk.chunkType,
        chunkIndex: chunk.chunkIndex,
        sectionTitle: chunk.sectionTitle,
        headingPath: [...chunk.headingPath],
        contentHash: chunk.contentHash,
        knowledgeTypes: [],
        domainTags: ["task-107-evaluation"],
        sourcePriority: chunk.sourcePriority,
        tokenCount: chunk.tokenCount,
        metadata: chunk.metadata,
      })),
    });
    const indexedChunks = await embedDocumentChunks(
      embeddingModel,
      chunks.map((chunk) => ({
        chunkId: chunk.chunkId,
        documentId: chunk.documentId,
        content: chunk.content,
      })),
    );
    for (const indexedChunk of indexedChunks) {
      const affectedRows = await persistDocumentChunkEmbedding(prisma, {
        workspaceId,
        chunkId: indexedChunk.chunkId,
        embedding: indexedChunk.embedding,
        embeddingModel: embeddingModel.model,
      });
      if (affectedRows !== 1) {
        throw new Error(`${item.path}: failed to persist ${indexedChunk.chunkId}`);
      }
    }
    await prisma.document.update({
      where: { id: document.id },
      data: { indexStatus: "indexed" },
    });
    chunkCount += indexedChunks.length;
  }
  return { documentCount: manifest.documents.length, chunkCount };
};

const writeReport = async (
  experimentLabel: string,
  manifest: CorpusManifest,
  dataset: GoldenDataset,
  indexing: Readonly<{ documentCount: number; chunkCount: number }>,
  results: readonly BaselineResult[],
): Promise<EvaluationMetrics> => {
  const hitAt5 = results.filter((result) => result.firstRelevantRank !== null).length;
  const reciprocalRank = results.reduce(
    (sum, result) => sum + (result.firstRelevantRank === null ? 0 : 1 / result.firstRelevantRank),
    0,
  );
  const answerableResults = results.filter((result) => result.answerable);
  const averageLatency = results.reduce((sum, result) => sum + result.latencyMs, 0) / results.length;
  const lines = [
    `## ${experimentLabel} 실행 결과 ${new Date().toISOString()}`,
    "",
    `- 실행 시각: ${new Date().toISOString()}`,
    `- Corpus: ${indexing.documentCount}개 문서, ${indexing.chunkCount}개 Chunk`,
    `- Chunking: maxTokens=${manifest.chunking.maxTokens}, overlapTokens=${manifest.chunking.overlapTokens}`,
    `- Embedding: ${manifest.embedding.model}, ${manifest.embedding.dimensions}차원`,
    `- 질문 수: ${dataset.questions.length}개`,
    `- Hit@5: ${hitAt5}/${results.length} (${((hitAt5 / results.length) * 100).toFixed(1)}%)`,
    `- MRR: ${(reciprocalRank / results.length).toFixed(4)}`,
    `- 평균 검색 latency: ${averageLatency.toFixed(1)}ms`,
    `- Answerable 질문 평균 latency: ${answerableResults.length === 0 ? "n/a" : (answerableResults.reduce((sum, result) => sum + result.latencyMs, 0) / answerableResults.length).toFixed(1) + "ms"}`,
    "",
    "## 질문별 결과",
    "",
    "| ID | Answerable | 첫 관련 결과 순위 | Latency | Top 결과 문서 |",
    "| --- | --- | ---: | ---: | --- |",
    ...results.map((result) => `| ${result.id} | ${result.answerable} | ${result.firstRelevantRank ?? "-"} | ${result.latencyMs.toFixed(1)}ms | ${result.results[0]?.documentPath ?? "-"} |`),
    "",
    "## 전체 검색 결과(JSON)",
    "",
    "```json",
    JSON.stringify(results, null, 2),
    "```",
  ];
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.appendFile(reportPath, `\n${lines.join("\n")}\n`, "utf8");
  return {
    label: experimentLabel,
    maxTokens: manifest.chunking.maxTokens,
    overlapTokens: manifest.chunking.overlapTokens,
    chunkCount: indexing.chunkCount,
    hitAt5,
    mrr: reciprocalRank / results.length,
  };
};

const writeThresholdReport = async (
  results: readonly BaselineResult[],
): Promise<void> => {
  const candidates = [0.35, 0.55, 0.6, 0.65, 0.7] as const;
  const scoreRows = results.map((result) => {
    const scores = result.results.map(({ score }) => score);
    const topScore = scores[0] ?? 0;
    const averageTopThree = scores.slice(0, 3).reduce((sum, score) => sum + score, 0) / Math.min(scores.length, 3);
    return { result, topScore, averageTopThree };
  });
  const lines = [
    `## Answerability threshold 평가 결과 ${new Date().toISOString()}`,
    "",
    "- 기준: Chunking 600/80 baseline",
    "- 정상 질문: 9개, 근거 없음 질문: 1개",
    "- 판정식: `topScore >= 후보값` AND `averageTopThree >= 후보값 - 0.10`",
    "",
    "### Score 분포",
    "",
    "| 그룹 | 질문 수 | Top score 평균 | Top score 범위 | Top 3 평균 평균 | Top 3 평균 범위 |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    ...([true, false] as const).map((answerable) => {
      const group = scoreRows.filter(({ result }) => result.answerable === answerable);
      const topScores = group.map(({ topScore }) => topScore);
      const averages = group.map(({ averageTopThree }) => averageTopThree);
      return `| ${answerable ? "정상" : "근거 없음"} | ${group.length} | ${(topScores.reduce((sum, score) => sum + score, 0) / group.length).toFixed(4)} | ${Math.min(...topScores).toFixed(4)}~${Math.max(...topScores).toFixed(4)} | ${(averages.reduce((sum, score) => sum + score, 0) / group.length).toFixed(4)} | ${Math.min(...averages).toFixed(4)}~${Math.max(...averages).toFixed(4)} |`;
    }),
    "",
    "### Threshold 후보 비교",
    "",
    "| Top threshold | Average Top 3 threshold | Accuracy | 정상 질문 거절 | 근거 없음 허용 |",
    "| ---: | ---: | ---: | ---: | ---: |",
    ...candidates.map((topThreshold) => {
      const averageThreshold = topThreshold - 0.1;
      const predictions = scoreRows.map(({ result, topScore, averageTopThree }) => ({
        expected: result.answerable,
        predicted: topScore >= topThreshold && averageTopThree >= averageThreshold,
      }));
      const correct = predictions.filter(({ expected, predicted }) => expected === predicted).length;
      const rejectedAnswerable = predictions.filter(({ expected, predicted }) => expected && !predicted).length;
      const allowedUnanswerable = predictions.filter(({ expected, predicted }) => !expected && predicted).length;
      return `| ${topThreshold.toFixed(2)} | ${averageThreshold.toFixed(2)} | ${(correct / predictions.length * 100).toFixed(1)}% | ${rejectedAnswerable}/${predictions.filter(({ expected }) => expected).length} | ${allowedUnanswerable}/${predictions.filter(({ expected }) => !expected).length} |`;
    }),
    "",
    "### 질문별 score",
    "",
    "| ID | 기대 Answerable | Top score | Average Top 3 |",
    "| --- | --- | ---: | ---: |",
    ...scoreRows.map(({ result, topScore, averageTopThree }) => `| ${result.id} | ${result.answerable} | ${topScore.toFixed(4)} | ${averageTopThree.toFixed(4)} |`),
  ];
  await fs.appendFile(reportPath, `\n${lines.join("\n")}\n`, "utf8");
};

const writeFinalEvaluationReport = async (
  results: readonly BaselineResult[],
  manifest: CorpusManifest,
  experimentMetrics: readonly EvaluationMetrics[],
): Promise<void> => {
  const answerableResults = results.filter((result) => result.answerable);
  const citationMatches = answerableResults.flatMap((result) =>
    result.results.map((row) => result.expectedDocumentPaths.includes(row.documentPath ?? "")),
  );
  const citationPrecision = citationMatches.length === 0
    ? 0
    : citationMatches.filter(Boolean).length / citationMatches.length;
  const thresholdTop = 0.65;
  const thresholdAverage = 0.55;
  const provisionalTop = 0.35;
  const provisionalAverage = 0.3;
  const predictions = results.map((result) => {
    const scores = result.results.map(({ score }) => score);
    const topScore = scores[0] ?? 0;
    const averageTopThree = scores.slice(0, 3).reduce((sum, score) => sum + score, 0) / Math.min(scores.length, 3);
    return {
      result,
      predicted: topScore >= thresholdTop && averageTopThree >= thresholdAverage,
    };
  });
  const answerabilityAccuracy = predictions.filter(({ result, predicted }) => result.answerable === predicted).length / predictions.length;
  const provisionalAccuracy = results.filter((result) => {
    const scores = result.results.map(({ score }) => score);
    const topScore = scores[0] ?? 0;
    const averageTopThree = scores.slice(0, 3).reduce((sum, score) => sum + score, 0) / Math.min(scores.length, 3);
    return result.answerable === (topScore >= provisionalTop && averageTopThree >= provisionalAverage);
  }).length / results.length;
  const failures = predictions.filter(({ result, predicted }) => result.answerable !== predicted || (result.answerable && result.firstRelevantRank === null));
  const sourceMissingCount = results.filter(
    (result) => result.answerable && result.firstRelevantRank === null,
  ).length;
  const lines = [
    "# TASK-107 평가 보고서",
    "",
    `- 작성 시각: ${new Date().toISOString()}`,
    `- Corpus: 6개 문서, Embedding=${manifest.embedding.model}, ${manifest.embedding.dimensions}차원`,
    "- Embedding 모델 비교: 제외 (고정 정책)",
    "- 기준 Chunking: 600/80",
    "",
    "## 평가 지표",
    "",
    `- Citation Precision: ${(citationPrecision * 100).toFixed(1)}% (정상 질문의 topK 결과 기준)`,
    `- Answerability Accuracy: ${(answerabilityAccuracy * 100).toFixed(1)}% (현재 threshold ${thresholdTop}/${thresholdAverage} 기준)`,
    `- 평가 전용 provisional threshold ${provisionalTop}/${provisionalAverage} Accuracy: ${(provisionalAccuracy * 100).toFixed(1)}%`,
    "- provisional Accuracy는 기대 문서의 topK 검색 여부를 검증하지 않고 threshold 판정만 측정한다.",
    `- 기대 문서가 topK에 포함되지 않은 정상 질문: ${sourceMissingCount}/${results.length}개`,
    "",
    "## 실패 질문 및 원인",
    "",
    failures.length === 0 ? "실패 질문 없음" : "| ID | 기대 Answerable | 원인 |\n| --- | --- | --- |",
    ...failures.map(({ result, predicted }) => {
      const reason = result.answerable && result.firstRelevantRank === null
        ? "기대 문서가 topK 검색 결과에 없음"
        : result.answerable !== predicted
          ? "threshold 판정과 기대 Answerable 불일치"
          : "검색 출처 평가 실패";
      return `| ${result.id} | ${result.answerable} | ${reason} |`;
    }),
    "",
    "## 결론 및 보류 사항",
    "",
    "| 구분 | Chunking | Embedding | Hit@5 | MRR |",
    "| --- | --- | --- | ---: | ---: |",
    ...experimentMetrics.map(
      (experiment) =>
        `| ${experiment.label} | ${experiment.maxTokens}/${experiment.overlapTokens} | ${manifest.embedding.model} / ${manifest.embedding.dimensions}차원 | ${(experiment.hitAt5 / results.length * 100).toFixed(1)}% | ${experiment.mrr.toFixed(4)} |`,
    ),
    "",
    "- 현재 Corpus와 Golden Question 규모가 작아 threshold 최종값은 확정하지 않았다.",
    "- 기존 threshold는 정상 질문을 과도하게 거절하므로 추가 평가 데이터로 재검토해야 한다.",
    "- provisional threshold는 평가용 참고값일 뿐 운영 코드에는 적용하지 않았다.",
    `- Chunking 비교 결과: ${experimentMetrics.map((experiment) => `${experiment.label}=${experiment.chunkCount}개 Chunk, Hit@5 ${(experiment.hitAt5 / results.length * 100).toFixed(1)}%, MRR ${experiment.mrr.toFixed(4)}`).join("; ")}.`,
    "- 상세 질문별 score와 설정별 원자료는 `docs/evaluation/task-107-vector-only-baseline.md`에 기록했다.",
  ];
  await fs.writeFile(finalReportPath, `${lines.join("\n")}\n`, "utf8");
};

const main = async (): Promise<void> => {
  dotenv.config({ path: path.join(rootPath, ".env") });
  const manifest = await loadJson<CorpusManifest>(corpusPath);
  const dataset = await loadJson<GoldenDataset>(goldenPath);
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (apiKey === undefined || apiKey.length === 0) {
    throw new Error("OPENAI_API_KEY is required");
  }
  const embeddingModel = createEmbeddingModel({
    openaiApiKey: apiKey,
    openaiEmbeddingModel: manifest.embedding.model,
    openaiEmbeddingDimensions: manifest.embedding.dimensions,
    ...(process.env.OPENAI_EMBEDDING_BASE_URL === undefined
      ? {}
      : { openaiEmbeddingBaseUrl: process.env.OPENAI_EMBEDDING_BASE_URL }),
  });
  const prisma = createPrismaClient();
  await prisma.$connect();
  try {
    const { workspaceId, dataSourceId } = await upsertEvaluationWorkspace(prisma, manifest.workspaceId);
    let baselineResults: readonly BaselineResult[] = [];
    const experimentMetrics: EvaluationMetrics[] = [];
    const experiments = [
      { label: "Chunking 400/50", maxTokens: 400, overlapTokens: 50 },
      { label: "Chunking 600/80 baseline", ...manifest.chunking },
      { label: "Chunking 800/100", maxTokens: 800, overlapTokens: 100 },
    ] as const;
    for (const experiment of experiments) {
      const experimentManifest: CorpusManifest = {
        ...manifest,
        chunking: {
          maxTokens: experiment.maxTokens,
          overlapTokens: experiment.overlapTokens,
        },
      };
      const indexing = await indexCorpus(prisma, experimentManifest, workspaceId, dataSourceId, embeddingModel);
      const results: BaselineResult[] = [];
      for (const question of dataset.questions) {
        const startedAt = performance.now();
        const rows = await searchDocumentChunksByEmbedding(prisma, {
          workspaceId,
          embedding: await embeddingModel.embedText(question.question),
          embeddingModel: embeddingModel.model,
          dimensions: embeddingModel.dimensions,
          topK: 5,
        });
        const chunks = await prisma.documentChunk.findMany({
          where: { id: { in: rows.map((row) => row.id) } },
          select: { id: true, document: { select: { filePath: true } } },
        });
        const pathByChunkId = new Map(chunks.map((chunk) => [chunk.id, chunk.document.filePath]));
        const resultRows = rows.map((row, index) => ({
          rank: index + 1,
          score: row.score,
          documentPath: pathByChunkId.get(row.id) ?? null,
          chunkId: row.id,
        }));
        const firstRelevant = resultRows.find((row) => row.documentPath !== null && question.expectedDocumentPaths.includes(row.documentPath));
        results.push({
          id: question.id,
          question: question.question,
          expectedDocumentPaths: question.expectedDocumentPaths,
          answerable: question.answerable,
          latencyMs: performance.now() - startedAt,
          results: resultRows,
          firstRelevantRank: firstRelevant?.rank ?? null,
        });
      }
      experimentMetrics.push(await writeReport(experiment.label, experimentManifest, dataset, indexing, results));
      if (experiment.label.includes("baseline")) {
        baselineResults = results;
      }
    }
    await writeThresholdReport(baselineResults);
    await writeFinalEvaluationReport(baselineResults, manifest, experimentMetrics);
    process.stdout.write(`Wrote ${reportPath}\n`);
  } finally {
    await disconnectPrismaClient();
  }
};

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown evaluation failure";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
