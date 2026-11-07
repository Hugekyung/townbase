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
import { fields } from "../auth/auth-policy";
import { AgentContractError } from "@townbase/agent-core";
import { ModelCallError } from "../model-integration/model-policy";
import { TransferDenied } from "../model-integration/transfer-policy";
import { databaseFailureCode } from "../diagnostics/database-failure";
import { RagService } from "./rag.service";
import { RagStore } from "./rag-store";

@Controller("rag")
export class RagController {
  constructor(
    private readonly rag: RagService,
    private readonly store: RagStore,
    private readonly access: AccessService,
  ) {}
  private async handle<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (error instanceof ModelCallError)
        throw new HttpException({ code: error.code }, error.status);
      if (error instanceof TransferDenied)
        throw new HttpException({ code: error.code }, 403);
      if (error instanceof AgentContractError)
        throw new HttpException({ code: error.code }, 400);
      Logger.error(
        `TOWNBASE_RAG_FAILED [${databaseFailureCode(error) ?? "unexpected_error"}]`,
      );
      throw new HttpException({ code: "question_unavailable" }, 503);
    }
  }
  private cursor(query: Record<string, unknown>) {
    if (
      Object.keys(query).some((k) => k !== "cursor") ||
      (query.cursor != null && typeof query.cursor !== "string")
    )
      throw new HttpException({ code: "invalid_request" }, 400);
    return query.cursor as string | undefined;
  }
  @Post("questions")
  @Header("Cache-Control", "no-store")
  ask(
    @Req() req: AccessRequest,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: { status(code: number): void },
  ) {
    return this.handle(async () => {
      const value = await this.rag.ask(
        readSessionCookie(req),
        this.access.requester(req),
        body,
      );
      response.status(value.status === "running" ? 202 : 200);
      return value;
    });
  }
  @Get("questions/:id")
  @Header("Cache-Control", "no-store")
  read(@Req() req: AccessRequest, @Param("id") id: string) {
    return this.handle(() =>
      this.store.read(readSessionCookie(req), this.access.requester(req), id),
    );
  }
  @Get("conversations")
  @Header("Cache-Control", "no-store")
  conversations(
    @Req() req: AccessRequest,
    @Query() query: Record<string, unknown>,
  ) {
    return this.handle(() =>
      this.store.conversations(
        readSessionCookie(req),
        this.access.requester(req),
        this.cursor(query),
      ),
    );
  }
  @Get("conversations/:id/turns")
  @Header("Cache-Control", "no-store")
  turns(
    @Req() req: AccessRequest,
    @Param("id") id: string,
    @Query() query: Record<string, unknown>,
  ) {
    return this.handle(() =>
      this.store.turns(
        readSessionCookie(req),
        this.access.requester(req),
        id,
        this.cursor(query),
      ),
    );
  }
  @Get("gaps")
  @Header("Cache-Control", "no-store")
  gaps(@Req() req: AccessRequest, @Query() query: Record<string, unknown>) {
    return this.handle(() =>
      this.store.gaps(
        readSessionCookie(req),
        this.access.requester(req),
        this.cursor(query),
      ),
    );
  }
  @Delete("gaps/:id")
  @Header("Cache-Control", "no-store")
  removeGap(
    @Req() req: AccessRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.handle(() => {
      if (!fields(body, []))
        throw new HttpException({ code: "invalid_request" }, 400);
      return this.store.removeGap(
        readSessionCookie(req),
        this.access.requester(req),
        id,
      );
    });
  }
}
