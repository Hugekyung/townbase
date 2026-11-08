import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpException,
  Logger,
  Param,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import { AccessService, type AccessRequest } from "../access/access.service";
import { readSessionCookie } from "../auth/auth-transport";
import { AgentContractError } from "@townbase/agent-core";
import { fields } from "../auth/auth-policy";
import {
  validRequestId,
  ModelCallError,
} from "../model-integration/model-policy";
import { TransferDenied } from "../model-integration/transfer-policy";
import { FileError } from "../files/file-contract";
import { fileInput } from "../files/file-upload";
import { AttachmentStore } from "./attachment-store";
import { AttachmentService } from "./attachment.service";
import { ATTACHMENT_LIMITS } from "./attachment-policy";
@Controller()
export class AttachmentController {
  constructor(
    private readonly store: AttachmentStore,
    private readonly service: AttachmentService,
    private readonly access: AccessService,
  ) {}
  private async handle<T>(work: () => Promise<T>) {
    try {
      return await work();
    } catch (e) {
      if (e instanceof HttpException) throw e;
      if (e instanceof ModelCallError)
        throw new HttpException({ code: e.code }, e.status);
      if (e instanceof AgentContractError)
        throw new HttpException({ code: e.code }, 400);
      if (e instanceof TransferDenied)
        throw new HttpException({ code: e.code }, 403);
      if (e instanceof FileError)
        throw new HttpException(
          { code: e.code },
          e.code === "storage_unavailable" ? 503 : 422,
        );
      Logger.error("TOWNBASE_ATTACHMENT_FAILED");
      throw new HttpException({ code: "attachment_unavailable" }, 503);
    }
  }
  private id(id: string) {
    if (!validRequestId(id))
      throw new HttpException({ code: "invalid_request_id" }, 400);
    return id.toLowerCase();
  }
  @Post("attachments") @Header("Cache-Control", "no-store") upload(
    @Req() req: AccessRequest,
    @Body() body: unknown,
  ) {
    return this.handle(() => {
      const file = fileInput(body, ATTACHMENT_LIMITS.bytes);
      return this.service.upload(
        readSessionCookie(req),
        this.access.requester(req),
        file.name,
        file.bytes,
      );
    });
  }
  @Get("attachments") @Header("Cache-Control", "no-store") files(
    @Req() req: AccessRequest,
  ) {
    return this.handle(() =>
      this.store.list(readSessionCookie(req), this.access.requester(req)),
    );
  }
  @Delete("attachments/:id") @Header("Cache-Control", "no-store") remove(
    @Req() req: AccessRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.handle(() => {
      if (!fields(body, [])) throw new ModelCallError("invalid_request");
      return this.store.remove(
        readSessionCookie(req),
        this.access.requester(req),
        this.id(id),
      );
    });
  }
  @Post("attachment-tasks") @Header("Cache-Control", "no-store") ask(
    @Req() req: AccessRequest,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: { status(n: number): void },
  ) {
    return this.handle(async () => {
      const r = await this.service.ask(
        readSessionCookie(req),
        this.access.requester(req),
        body,
      );
      res.status(r.status === "running" ? 202 : 200);
      return r;
    });
  }
  @Get("attachment-tasks") @Header("Cache-Control", "no-store") list(
    @Req() req: AccessRequest,
    @Query() query: Record<string, unknown>,
  ) {
    return this.handle(async () => {
      if (
        Object.keys(query).some((k) => k !== "cursor" && k !== "view") ||
        (query.cursor != null && typeof query.cursor !== "string") ||
        (query.view != null && query.view !== "summary")
      )
        throw new ModelCallError("invalid_request");
      const cursor =
        query.cursor == null ? undefined : this.id(String(query.cursor));
      return this.store[query.view === "summary" ? "summaries" : "history"](
        readSessionCookie(req),
        this.access.requester(req),
        cursor,
      );
    });
  }
  @Get("attachment-tasks/:id") @Header("Cache-Control", "no-store") read(
    @Req() req: AccessRequest,
    @Param("id") id: string,
  ) {
    return this.handle(() =>
      this.store.read(
        readSessionCookie(req),
        this.access.requester(req),
        this.id(id),
      ),
    );
  }
  @Delete("attachment-tasks/:id")
  @Header("Cache-Control", "no-store")
  removeResult(
    @Req() req: AccessRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.handle(() => {
      if (!fields(body, [])) throw new ModelCallError("invalid_request");
      return this.store.removeResult(
        readSessionCookie(req),
        this.access.requester(req),
        this.id(id),
      );
    });
  }
  @Post("attachment-tasks/:id/stop") @Header("Cache-Control", "no-store") stop(
    @Req() req: AccessRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.handle(() => {
      if (!fields(body, [])) throw new ModelCallError("invalid_request");
      return this.service.stop(
        readSessionCookie(req),
        this.access.requester(req),
        this.id(id),
      );
    });
  }
}
