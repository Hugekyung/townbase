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

const rootPath = path.resolve(__dirname, "../../../..");
const corpusPath = path.join(rootPath, "fixtures/evaluation/corpus.json");
const goldenPath = path.join(rootPath, "fixtures/evaluation/golden-questions.json");
const reportPath = path.join(rootPath, "docs/evaluation/task-107-vector-only-baseline.md");

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
): Promise<void> => {
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
      await writeReport(experiment.label, experimentManifest, dataset, indexing, results);
    }
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
