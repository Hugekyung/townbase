import { createHash, randomUUID } from "node:crypto";
import { Injectable, UnauthorizedException } from "@nestjs/common";
import { Prisma, toPgVectorLiteral } from "@townbase/database";
import { AuthService, type AdministratorContext } from "../auth/auth.service";
import { ModelExecutionService } from "../model-integration/model-execution.service";
import { ModelCallError } from "../model-integration/model-policy";
import {
  inspectTransfer,
  OPENAI_ENDPOINTS,
} from "../model-integration/transfer-policy";
import {
  fileChunks,
  chunkRequestId,
  embeddingVector,
  FILE_INDEX_CONFIGURATION,
  CHUNK_BYTES,
} from "./file-chunker";
import { assertExtraction, FileError, type FileFormat } from "./file-contract";
import { currentFileWhere, currentIndexWhere } from "./file-index-state";

import { FileStorage } from "./file-storage";

type Tx = Prisma.TransactionClient;
type Run = Prisma.FileRunGetPayload<Record<string, never>>;
type Completion = {
  originalId: string;
  versionId: string;
  extractionRunId: string;
  status: string;
  errorCode: null;
};
@Injectable()
export class FileIndexService {
  constructor(
    private readonly auth: AuthService,
    private readonly model: ModelExecutionService,
    private readonly originals: FileStorage,
  ) {}
  private async scoped<T>(
    token: string | undefined,
    context: AdministratorContext,
    work: (tx: Tx, c: AdministratorContext) => Promise<T>,
  ) {
    const result = await this.auth.authorizedOperation(
      token,
      context,
      async (tx, c) => ({ value: await work(tx, c) }),
    );
    if (!result.ok) throw new UnauthorizedException();
    return result.value;
  }
  private async snapshot(tx: Tx, c: AdministratorContext, run: Run) {
    const version = await tx.fileVersion.findFirst({
      where: {
        id: run.baseVersionId!,
        installationId: c.installationId,
        originalId: run.targetOriginalId!,
        rawDeletedAt: null,
        documentStatus: "active",
        original: { ownerAdministratorId: c.administratorId, deletedAt: null },
      },
      include: {
        runs: { orderBy: { ordinal: "desc" }, take: 1 },
        original: true,
      },
    });
    if (!version || version.runs[0]?.status !== "extracted")
      throw new ModelCallError("source_not_extracted", 409);
    const newer = await tx.fileVersion.count({
      where: {
        installationId: c.installationId,
        originalId: version.originalId,
        version: { gt: version.version },
      },
    });
    if (newer) throw new ModelCallError("source_changed", 409);
    assertExtraction(version.extraction, version.format as FileFormat);
    const [hash] = await tx.$queryRaw<
      Array<{ digest: string }>
    >`SELECT encode(sha256(convert_to(extraction::text,'UTF8')),'hex') AS digest FROM "FileVersion" WHERE id=${version.id}::uuid AND "installationId"=${c.installationId}`;
    if (!hash?.digest) throw new ModelCallError("source_not_extracted", 409);
    const settings = await tx.modelExecutionSettings.findUnique({
      where: { installationId: c.installationId },
      select: { inputTokenLimit: true },
    });
    const chunkBytes = Math.min(
      CHUNK_BYTES,
      (settings?.inputTokenLimit ?? 16000) - 256,
    );
    return {
      version,
      extraction: version.extraction,
      digest: hash.digest,
      chunkBytes,
    };
  }
  async execute(
    token: string | undefined,
    context: AdministratorContext,
    run: Run,
    signal: AbortSignal,
    guard: (tx: Tx, c: AdministratorContext) => Promise<void>,
    complete: (tx: Tx, value: Completion, unchanged: boolean) => Promise<void>,
  ) {
    const source = await this.scoped(token, context, async (tx, c) => {
      await guard(tx, c);
      return this.snapshot(tx, c, run);
    });
    // Read the bounded original outside auth transactions before any external call.
    // A missing/corrupt restored file must not be represented by a fresh index.
    const bytes = await this.originals.read(source.version.storageKey);
    if (
      bytes.length !== source.version.byteSize ||
      createHash("sha256").update(bytes).digest("hex") !==
        source.version.contentHash
    )
      throw new FileError("storage_unavailable");
    const check = async (tx: Tx, c: AdministratorContext) => {
      await guard(tx, c);
      if (signal.aborted) throw new ModelCallError("call_cancelled", 409);
      // Recheck the digest and eligibility in SQL without rereading/validating
      // the entire extracted body for every chunk admission.
      const [latest] = await tx.$queryRaw<Array<{ digest: string }>>(Prisma.sql`
        SELECT encode(sha256(convert_to(v.extraction::text,'UTF8')),'hex') AS digest
        FROM "FileVersion" v JOIN "FileOriginal" o ON o.id=v."originalId" AND o."installationId"=v."installationId"
        WHERE v.id=${source.version.id}::uuid AND v."installationId"=${c.installationId}
        AND o."ownerAdministratorId"=${c.administratorId} AND ${currentFileWhere}`);
      if (latest?.digest !== source.digest)
        throw new ModelCallError("source_changed", 409);
    };
    const finish = {
      originalId: source.version.originalId,
      versionId: source.version.id,
      extractionRunId: source.version.runs[0]!.id,
      status: "extracted",
      errorCode: null,
    };
    const unchanged = await this.scoped(token, context, async (tx, c) => {
      await check(tx, c);
      const old = await tx.fileIndex.findUnique({
        where: {
          installationId_versionId: {
            installationId: c.installationId,
            versionId: source.version.id,
          },
        },
      });
      if (
        old?.extractionDigest === source.digest &&
        old.configurationVersion === FILE_INDEX_CONFIGURATION &&
        old.chunkBytes === source.chunkBytes &&
        old.chunkCount ===
          (await tx.fileIndexChunk.count({
            where: { installationId: c.installationId, indexId: old.id },
          }))
      ) {
        await complete(tx, finish, true);
        return true;
      }
      return false;
    });
    if (unchanged) return;
    // Inspect the whole document before chunking, so a secret split across chunks cannot escape.
    inspectTransfer(
      { documentEmbedding: true, rag: false, attachment: false },
      "document_embedding",
      OPENAI_ENDPOINTS.embedding,
      source.extraction.segments.map((s) => s.text).join("\n"),
      [source.version.fileName],
    );
    // Same original bytes and extraction may be rebound to a replacement version
    // without paying to embed the same text again. Never merge distinct originals.
    const reused = await this.scoped(token, context, async (tx, c) => {
      await check(tx, c);
      const prior = await tx.fileIndex.findFirst({
        where: {
          installationId: c.installationId,
          ownerAdministratorId: c.administratorId,
          originalId: source.version.originalId,
          versionId: { not: source.version.id },
          extractionDigest: source.digest,
          configurationVersion: FILE_INDEX_CONFIGURATION,
          chunkBytes: source.chunkBytes,
          embeddingModel: "text-embedding-3-small",
          version: {
            contentHash: source.version.contentHash,
            format: source.version.format,
          },
        },
        orderBy: { createdAt: "desc" },
      });
      if (
        !prior ||
        prior.chunkCount !==
          (await tx.fileIndexChunk.count({
            where: { installationId: c.installationId, indexId: prior.id },
          }))
      )
        return false;
      await tx.fileIndex.deleteMany({
        where: {
          installationId: c.installationId,
          versionId: source.version.id,
        },
      });
      const id = randomUUID();
      await tx.fileIndex.create({
        data: {
          id,
          installationId: c.installationId,
          ownerAdministratorId: c.administratorId,
          originalId: source.version.originalId,
          versionId: source.version.id,
          originRunId: run.id,
          extractionDigest: source.digest,
          configurationVersion: FILE_INDEX_CONFIGURATION,
          chunkBytes: source.chunkBytes,
          embeddingModel: "text-embedding-3-small",
          chunkCount: prior.chunkCount,
        },
      });
      const old = await tx.fileIndexChunk.findMany({
        where: { installationId: c.installationId, indexId: prior.id },
        select: { id: true },
      });
      // Copy opaque vectors inside PostgreSQL; propagate the new version's metadata.
      for (let start = 0; start < old.length; start += 32) {
        const copies = old
          .slice(start, start + 32)
          .map(
            (row) =>
              Prisma.sql`SELECT ${randomUUID()}::uuid, "installationId",${id}::uuid,ordinal,content,"contentHash","headingPath",locations,"sourceType",${source.version.knowledgeTypes}::"KnowledgeType"[],${source.version.domainTags}::text[],${source.version.documentStatus}::"DocumentStatus","sourcePriority","modelCallRequestId",embedding FROM "FileIndexChunk" WHERE id=${row.id}::uuid AND "installationId"=${c.installationId}`,
          );
        await tx.$executeRaw(
          Prisma.sql`INSERT INTO "FileIndexChunk" (id,"installationId","indexId",ordinal,content,"contentHash","headingPath",locations,"sourceType","knowledgeTypes","domainTags",status,"sourcePriority","modelCallRequestId",embedding) ${Prisma.join(copies, " UNION ALL ")}`,
        );
      }
      await complete(tx, finish, true);
      return true;
    });
    if (reused) return;
    const chunks = fileChunks(source.extraction, source.chunkBytes);
    if (!chunks.length) throw new ModelCallError("source_not_extracted", 409);
    const vectors: number[][] = [];
    const requests: string[] = [];
    for (let ordinal = 0; ordinal < chunks.length; ordinal++) {
      const requestId = chunkRequestId(run.id, ordinal);
      const result = await this.model.execute(
        token,
        context,
        {
          requestId,
          purpose: "document_embedding",
          input: chunks[ordinal]!.content,
          fileNames: [source.version.fileName],
        },
        {
          signal,
          authorize: async (tx, c) => {
            await check(tx, c);
          },
        },
      );
      // Prior charged/unknown requests are never automatically resent or represented by fake vectors.
      if (!result.result || result.call.status !== "succeeded")
        throw new ModelCallError(
          result.call.errorCode ?? "embedding_result_unavailable",
          409,
        );
      try {
        embeddingVector(result.result.embedding);
      } catch {
        throw new ModelCallError("embedding_dimension_or_value_mismatch", 502);
      }
      vectors.push(result.result.embedding);
      requests.push(requestId);
    }
    await this.scoped(token, context, async (tx, c) => {
      await check(tx, c);
      await tx.fileIndex.deleteMany({
        where: {
          installationId: c.installationId,
          versionId: source.version.id,
        },
      });
      const index = await tx.fileIndex.create({
        data: {
          id: randomUUID(),
          installationId: c.installationId,
          ownerAdministratorId: c.administratorId,
          originalId: source.version.originalId,
          versionId: source.version.id,
          originRunId: run.id,
          extractionDigest: source.digest,
          configurationVersion: FILE_INDEX_CONFIGURATION,
          chunkBytes: source.chunkBytes,
          embeddingModel: "text-embedding-3-small",
          chunkCount: chunks.length,
        },
      });
      for (let start = 0; start < chunks.length; start += 32) {
        const values = chunks.slice(start, start + 32).map((chunk, offset) => {
          const ordinal = start + offset;
          return Prisma.sql`(${randomUUID()}::uuid,${c.installationId},${index.id}::uuid,${ordinal},${chunk.content},${chunk.contentHash},${JSON.stringify(chunk.headingPath)}::jsonb,${JSON.stringify(chunk.parts)}::jsonb,'uploaded_file'::"SourceType",${source.version.knowledgeTypes}::"KnowledgeType"[],${source.version.domainTags}::text[],${source.version.documentStatus}::"DocumentStatus",50,${requests[ordinal]}::uuid,${toPgVectorLiteral(vectors[ordinal]!)}::vector)`;
        });
        await tx.$executeRaw(
          Prisma.sql`INSERT INTO "FileIndexChunk" (id,"installationId","indexId",ordinal,content,"contentHash","headingPath",locations,"sourceType","knowledgeTypes","domainTags",status,"sourcePriority","modelCallRequestId",embedding) VALUES ${Prisma.join(values)}`,
        );
      }
      await complete(tx, finish, false);
    });
  }
  // Internal E retrieval entrypoint. The caller supplies only a validated fixed-model question vector.
  async search(
    token: string | undefined,
    context: AdministratorContext,
    vector: unknown,
    topK = 5,
  ) {
    try {
      embeddingVector(vector);
    } catch {
      throw new ModelCallError("invalid_search_vector");
    }
    if (!Number.isInteger(topK) || topK < 1 || topK > 20)
      throw new ModelCallError("invalid_search_limit");
    return this.scoped(token, context, (tx, c) =>
      tx.$queryRaw<
        Array<{
          id: string;
          originalId: string;
          versionId: string;
          content: string;
          title: string;
          fileName: string;
          format: string;
          contentHash: string;
          chunkHash: string;
          locations: unknown;
          headingPath: unknown;
          sourceType: string;
          knowledgeTypes: string[];
          domainTags: string[];
          status: string;
          sourcePriority: number;
          requestedMode: string | null;
          resolvedMode: string | null;
          score: number;
          reference: string;
        }>
      >(Prisma.sql`
      SELECT ch.id,i."originalId",i."versionId",o.title,v."fileName",v.format,v."contentHash",ch."contentHash" AS "chunkHash",ch.content,ch.locations,ch."headingPath",ch."sourceType",ch."knowledgeTypes",ch."domainTags",ch.status,ch."sourcePriority",ch."requestedMode",ch."resolvedMode",1-(ch.embedding <=> ${toPgVectorLiteral(vector)}::vector) AS score, '/files/'||o.id::text||'/reference' AS reference
      FROM "FileIndexChunk" ch JOIN "FileIndex" i ON i.id=ch."indexId" AND i."installationId"=ch."installationId"
      JOIN "FileVersion" v ON v.id=i."versionId" AND v."installationId"=i."installationId"
      JOIN "FileOriginal" o ON o.id=i."originalId" AND o."installationId"=i."installationId"
      WHERE i."installationId"=${c.installationId} AND o."ownerAdministratorId"=${c.administratorId} AND i."ownerAdministratorId"=${c.administratorId} AND ${currentIndexWhere}
      ORDER BY ch.embedding <=> ${toPgVectorLiteral(vector)}::vector, ch.id LIMIT ${topK}`),
    );
  }
}
