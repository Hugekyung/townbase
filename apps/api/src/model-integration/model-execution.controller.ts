import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpException,
  Logger,
  Param,
  Post,
  Put,
  Req,
  ServiceUnavailableException,
} from "@nestjs/common";
import { AccessService, type AccessRequest } from "../access/access.service";
import { fields } from "../auth/auth-policy";
import { readSessionCookie } from "../auth/auth-transport";
import { integrationFailureCode } from "./model-integration.controller";
import {
  ModelCallError,
  validExecution,
  type ExecutionSettings,
} from "./model-policy";
import { TransferDenied } from "./transfer-policy";
import { ModelExecutionService } from "./model-execution.service";
@Controller("settings/model-integration")
export class ModelExecutionController {
  constructor(
    private readonly execution: ModelExecutionService,
    private readonly access: AccessService,
  ) {}
  private async handle<T>(work: () => Promise<T>) {
    try {
      return await work();
    } catch (error) {
      if (error instanceof ModelCallError)
        throw new HttpException({ code: error.code }, error.status);
      if (error instanceof TransferDenied)
        throw new HttpException({ code: error.code }, 403);
      Logger.error(
        `Model execution unavailable [${integrationFailureCode(error)}].`,
      );
      throw new ServiceUnavailableException({
        code: "integration_unavailable",
      });
    }
  }
  @Get("execution")
  @Header("Cache-Control", "no-store")
  snapshot(@Req() req: AccessRequest) {
    return this.handle(() =>
      this.execution.snapshot(this.access.requester(req)),
    );
  }
  @Put("execution")
  @Header("Cache-Control", "no-store")
  configure(@Req() req: AccessRequest, @Body() body: unknown) {
    if (
      !fields(body, [
        "currentPassword",
        "answerModel",
        "reasoning",
        "inputTokenLimit",
        "outputTokenLimit",
        "monthlyBudgetUsd",
        "priceVersion",
      ]) ||
      !validExecution(body)
    )
      throw new HttpException({ code: "invalid_request" }, 400);
    const value: ExecutionSettings = {
      answerModel: body.answerModel,
      reasoning: body.reasoning,
      inputTokenLimit: body.inputTokenLimit,
      outputTokenLimit: body.outputTokenLimit,
      monthlyBudgetUsd: body.monthlyBudgetUsd,
      priceVersion: body.priceVersion,
    };
    return this.handle(async () => {
      const result = await this.execution.configure(
        readSessionCookie(req),
        (body as unknown as { currentPassword: unknown }).currentPassword,
        this.access.requester(req),
        value,
      );
      if (!result.ok)
        throw new ModelCallError(
          result.code,
          result.code === "throttled"
            ? 429
            : result.code === "invalid_request"
              ? 400
              : 401,
        );
      return { settings: result.settings };
    });
  }
  @Post("checks/:purpose")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  check(
    @Req() req: AccessRequest,
    @Param("purpose") purpose: string,
    @Body() body: unknown,
  ) {
    if (
      (purpose !== "answer" && purpose !== "embedding") ||
      !fields(body, ["currentPassword", "requestId"]) ||
      typeof body.requestId !== "string"
    )
      throw new HttpException({ code: "invalid_request" }, 400);
    return this.handle(async () => {
      const result = await this.execution.check(
        readSessionCookie(req),
        body.currentPassword,
        this.access.requester(req),
        body.requestId as string,
        purpose,
      );
      // A connection check never publishes generated text/vectors.
      return { call: result.call };
    });
  }
  @Get("calls/:requestId")
  @Header("Cache-Control", "no-store")
  status(@Req() req: AccessRequest, @Param("requestId") id: string) {
    return this.handle(() =>
      this.execution.status(this.access.requester(req), id),
    );
  }
}
