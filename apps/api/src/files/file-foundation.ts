import { createHash, randomUUID } from "node:crypto";
import { UnauthorizedException, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@townbase/database";
import { AuthService, type AdministratorContext } from "../auth/auth.service";
import { FileExtractor } from "./file-extractor";
import { FileStorage } from "./file-storage";
import {
  FILE_LIMITS,
  assertExtraction,
  type FileFormat,
  FileError,
  fileFormat,
  type FileExtraction,
} from "./file-contract";

// D01 internal foundation only: no controller, public upload route, embedding or queue.
// D02 will call this after validating its upload/body/Content-Type contract.
export class FileFoundation {
  constructor(
    private readonly auth: AuthService,
    private readonly extractor: FileExtractor,
    private readonly storage: FileStorage,
  ) {}

  async create(
    token: string | undefined,
    expected: AdministratorContext,
    name: string,
    input: Buffer,
  ) {
    const admitted = await this.auth.authorizedOperation(
      token,
      expected,
      async () => ({}),
    );
    if (!admitted.ok) throw new UnauthorizedException();
    const format = fileFormat(name);
    if (input.length === 0 || input.length > FILE_LIMITS.bytes)
      throw new FileError("file_too_large");
    const bytes = Buffer.from(input),
      startedAt = new Date();
    let extraction: FileExtraction | undefined,
      errorCode: FileError["code"] | undefined;
    try {
      extraction = await this.extractor.extract(name, bytes);
    } catch (error) {
      // Capacity/unavailable failures do not register a document as a content failure.
      if (
        !(error instanceof FileError) ||
        ["parser_busy", "parser_unavailable", "storage_unavailable"].includes(
          error.code,
        )
      )
        throw error;
      errorCode = error.code;
    }
    const completedAt = new Date();
    const storageKey = await this.storage.write(bytes);
    let committed = false;
    try {
      const result = await this.auth.authorizedOperation(
        token,
        expected,
        async (tx, context) => {
          const original = await tx.fileOriginal.create({
            data: {
              id: randomUUID(),
              installationId: context.installationId,
              ownerAdministratorId: context.administratorId,
              title: name,
            },
          });
          const version = await tx.fileVersion.create({
            data: {
              id: storageKey.slice(0, -4),
              installationId: context.installationId,
              originalId: original.id,
              version: 1,
              fileName: name,
              format,
              byteSize: bytes.length,
              contentHash: createHash("sha256").update(bytes).digest("hex"),
              storageKey,
              knowledgeTypes: ["unknown"],
              domainTags: [],
              ...(extraction
                ? { extraction: extraction as unknown as Prisma.InputJsonValue }
                : {}),
            },
          });
          const run = await tx.fileExtractionRun.create({
            data: {
              id: randomUUID(),
              installationId: context.installationId,
              versionId: version.id,
              status: extraction ? "extracted" : "failed",
              errorCode: errorCode ?? null,
              startedAt,
              completedAt,
            },
          });
          return {
            originalId: original.id,
            versionId: version.id,
            runId: run.id,
          };
        },
      );
      if (!result.ok) throw new UnauthorizedException();
      committed = true;
      return {
        originalId: result.originalId,
        versionId: result.versionId,
        runId: result.runId,
      };
    } finally {
      // Never do filesystem work under the authentication/DB transaction lock.
      if (!committed) await this.storage.remove(storageKey);
    }
  }

  async read(
    token: string | undefined,
    expected: AdministratorContext,
    originalId: string,
  ) {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        originalId,
      )
    )
      throw new NotFoundException();
    const result = await this.auth.authorizedOperation(
      token,
      expected,
      async (tx, context) => {
        const original = await tx.fileOriginal.findFirst({
          where: {
            id: originalId,
            installationId: context.installationId,
            ownerAdministratorId: context.administratorId,
          },
          include: {
            versions: {
              orderBy: { version: "desc" },
              include: { runs: { orderBy: { completedAt: "desc" } } },
            },
          },
        });
        if (!original) throw new NotFoundException();
        for (const version of original.versions) {
          if (version.extraction != null)
            assertExtraction(version.extraction, version.format as FileFormat);
        }
        // storageKey is internal. An authenticated raw-file reference is a D02 endpoint.
        return {
          original: {
            ...original,
            versions: original.versions.map(
              ({ storageKey: _key, ...version }) => version,
            ),
          },
        };
      },
    );
    if (!result.ok) throw new UnauthorizedException();
    return result.original;
  }
}
