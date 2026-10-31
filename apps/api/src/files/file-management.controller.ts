import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Headers,
  HttpCode,
  HttpException,
  Param,
  Post,
  Put,
  Query,
  Req,
  StreamableFile,
  Logger,
} from "@nestjs/common";
import { AccessService, type AccessRequest } from "../access/access.service";
import { readSessionCookie } from "../auth/auth-transport";
import { TransferDenied } from "../model-integration/transfer-policy";
import { FileRunService } from "./file-run.service";
import { FileError } from "./file-contract";
import { UUID } from "./file-management.service";
import { FileManagementService } from "./file-management.service";
import { fileInput } from "./file-upload";

@Controller("files")
export class FileManagementController {
  constructor(
    private readonly files: FileManagementService,
    private readonly access: AccessService,
    private readonly runs: FileRunService,
  ) {}
  private async run<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (error instanceof FileError)
        throw new HttpException(
          { code: error.code },
          error.code === "file_too_large"
            ? 413
            : ["parser_busy"].includes(error.code)
              ? 409
              : ["storage_unavailable", "parser_unavailable"].includes(
                    error.code,
                  )
                ? 503
                : 422,
        );
      if (error instanceof TransferDenied)
        throw new HttpException({ code: "sensitive_file" }, 422);
      Logger.error("TOWNBASE_FILE_OPERATION_FAILED");
      throw new HttpException({ code: "file_unavailable" }, 503);
    }
  }
  @Get()
  @Header("Cache-Control", "no-store")
  list(@Req() req: AccessRequest, @Query() query: Record<string, unknown>) {
    return this.run(() => {
      if (
        Object.keys(query).some((key) => key !== "cursor") ||
        (query.cursor != null && typeof query.cursor !== "string")
      )
        throw new HttpException({ code: "invalid_request" }, 400);
      return this.files.list(
        readSessionCookie(req),
        this.access.requester(req),
        query.cursor as string | undefined,
      );
    });
  }
  @Get(":id")
  @Header("Cache-Control", "no-store")
  read(@Req() req: AccessRequest, @Param("id") id: string) {
    return this.run(() =>
      this.files.read(readSessionCookie(req), this.access.requester(req), id),
    );
  }
  @Get(":id/reference")
  @Header("Cache-Control", "no-store")
  reference(
    @Req() req: AccessRequest,
    @Param("id") id: string,
    @Query() query: Record<string, unknown>,
  ) {
    return this.run(async () => {
      let expected: { versionId: string; scopeRevision: number } | undefined;
      if (Object.keys(query).length) {
        if (
          Object.keys(query).some(
            (k) => !["versionId", "scopeRevision"].includes(k),
          ) ||
          typeof query.versionId !== "string" ||
          !UUID.test(query.versionId) ||
          typeof query.scopeRevision !== "string" ||
          !/^[1-9][0-9]{0,9}$/.test(query.scopeRevision) ||
          Number(query.scopeRevision) > 2147483647
        )
          throw new HttpException({ code: "invalid_request" }, 400);
        expected = {
          versionId: query.versionId.toLowerCase(),
          scopeRevision: Number(query.scopeRevision),
        };
      }
      const result = await this.files.reference(
        readSessionCookie(req),
        this.access.requester(req),
        id,
        expected,
      );
      return new StreamableFile(result.bytes, {
        type: "application/octet-stream",
        length: result.bytes.length,
        disposition: `attachment; filename="document"; filename*=UTF-8''${encodeURIComponent(result.name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`,
      });
    });
  }
  @Post()
  @HttpCode(202)
  @Header("Cache-Control", "no-store")
  register(
    @Req() req: AccessRequest,
    @Body() body: unknown,
    @Headers("x-townbase-request-id") requestId: unknown,
  ) {
    return this.run(() => {
      const { name, bytes } = fileInput(body);
      return this.runs.upload(
        readSessionCookie(req),
        this.access.requester(req),
        requestId,
        name,
        bytes,
      );
    });
  }
  @Put(":id")
  @HttpCode(202)
  @Header("Cache-Control", "no-store")
  replace(
    @Req() req: AccessRequest,
    @Param("id") id: string,
    @Body() body: unknown,
    @Headers("x-townbase-request-id") requestId: unknown,
  ) {
    return this.run(() => {
      const { name, bytes } = fileInput(body);
      return this.runs.upload(
        readSessionCookie(req),
        this.access.requester(req),
        requestId,
        name,
        bytes,
        id,
      );
    });
  }
  @Put(":id/scope")
  @Header("Cache-Control", "no-store")
  scope(
    @Req() req: AccessRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.run(() => {
      if (
        body == null ||
        typeof body !== "object" ||
        Array.isArray(body) ||
        Object.keys(body).length !== 1 ||
        !("included" in body) ||
        Object.keys(body)[0] !== "included" ||
        typeof body.included !== "boolean"
      )
        throw new HttpException({ code: "invalid_request" }, 400);
      return this.files.setScope(
        readSessionCookie(req),
        this.access.requester(req),
        id,
        body.included,
      );
    });
  }
  @Post(":id/index")
  @HttpCode(202)
  @Header("Cache-Control", "no-store")
  index(
    @Req() req: AccessRequest,
    @Param("id") id: string,
    @Headers("x-townbase-request-id") requestId: unknown,
    @Body() body: unknown,
  ) {
    return this.run(() => {
      if (
        body == null ||
        typeof body !== "object" ||
        Array.isArray(body) ||
        Object.keys(body).length !== 0
      )
        throw new HttpException({ code: "invalid_request" }, 400);
      return this.runs.index(
        readSessionCookie(req),
        this.access.requester(req),
        requestId,
        id,
      );
    });
  }
  @Post(":id/reprocess")
  @HttpCode(202)
  @Header("Cache-Control", "no-store")
  reprocess(
    @Req() req: AccessRequest,
    @Param("id") id: string,
    @Headers("x-townbase-request-id") requestId: unknown,
    @Body() body: unknown,
  ) {
    return this.run(() => {
      if (
        body == null ||
        typeof body !== "object" ||
        Array.isArray(body) ||
        Object.keys(body).length !== 0
      )
        throw new HttpException({ code: "invalid_request" }, 400);
      return this.runs.reprocess(
        readSessionCookie(req),
        this.access.requester(req),
        requestId,
        id,
      );
    });
  }
  @Delete(":id")
  @Header("Cache-Control", "no-store")
  remove(
    @Req() req: AccessRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.run(() => {
      if (
        body == null ||
        typeof body !== "object" ||
        Array.isArray(body) ||
        Object.keys(body).length !== 0
      )
        throw new HttpException({ code: "invalid_request" }, 400);
      return this.files.remove(
        readSessionCookie(req),
        this.access.requester(req),
        id,
      );
    });
  }
}
