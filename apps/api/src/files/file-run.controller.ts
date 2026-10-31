import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  HttpException,
  Logger,
  Param,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { AccessService, type AccessRequest } from "../access/access.service";
import { readSessionCookie } from "../auth/auth-transport";
import { FileRunService } from "./file-run.service";
import { FileError } from "./file-contract";

@Controller("file-runs")
export class FileRunController {
  constructor(
    private readonly runs: FileRunService,
    private readonly access: AccessService,
  ) {}
  private async invoke<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (error instanceof FileError)
        throw new HttpException(
          { code: error.code },
          error.code === "file_too_large" ? 413 : 503,
        );
      Logger.error("TOWNBASE_FILE_RUN_REQUEST_FAILED");
      throw new HttpException({ code: "file_run_unavailable" }, 503);
    }
  }
  @Get()
  @Header("Cache-Control", "no-store")
  list(@Req() req: AccessRequest, @Query() query: Record<string, unknown>) {
    return this.invoke(() => {
      if (
        Object.keys(query).some((key) => key !== "cursor") ||
        (query.cursor != null && typeof query.cursor !== "string")
      )
        throw new HttpException({ code: "invalid_request" }, 400);
      return this.runs.list(
        readSessionCookie(req),
        this.access.requester(req),
        query.cursor as string | undefined,
      );
    });
  }
  @Get("requests/:id")
  @Header("Cache-Control", "no-store")
  byRequest(@Req() req: AccessRequest, @Param("id") id: string) {
    return this.invoke(() =>
      this.runs.byRequest(
        readSessionCookie(req),
        this.access.requester(req),
        id,
      ),
    );
  }
  @Get(":id")
  @Header("Cache-Control", "no-store")
  read(@Req() req: AccessRequest, @Param("id") id: string) {
    return this.invoke(() =>
      this.runs.read(readSessionCookie(req), this.access.requester(req), id),
    );
  }
  private empty(body: unknown) {
    if (
      body == null ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      Object.keys(body).length !== 0
    )
      throw new HttpException({ code: "invalid_request" }, 400);
  }
  @Post(":id/retry")
  @HttpCode(202)
  @Header("Cache-Control", "no-store")
  retry(
    @Req() req: AccessRequest,
    @Param("id") id: string,
    @Headers("x-townbase-request-id") requestId: unknown,
    @Body() body: unknown,
  ) {
    return this.invoke(() => {
      this.empty(body);
      return this.runs.retry(
        readSessionCookie(req),
        this.access.requester(req),
        requestId,
        id,
      );
    });
  }
  @Post(":id/stop")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  stop(
    @Req() req: AccessRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.invoke(() => {
      this.empty(body);
      return this.runs.stop(
        readSessionCookie(req),
        this.access.requester(req),
        id,
      );
    });
  }
}
