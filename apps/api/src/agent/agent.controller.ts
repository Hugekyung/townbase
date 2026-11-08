import {
  Body,
  Controller,
  Get,
  Header,
  HttpException,
  Logger,
  Put,
  Req,
} from "@nestjs/common";
import { AccessService, type AccessRequest } from "../access/access.service";
import { readSessionCookie } from "../auth/auth-transport";
import { fields } from "../auth/auth-policy";
import { AGENT_FIELDS, validAgentConfiguration } from "./agent-policy";
import { AgentService } from "./agent.service";

@Controller("settings/agent")
export class AgentController {
  constructor(
    private readonly agents: AgentService,
    private readonly access: AccessService,
  ) {}
  private async handle<T>(work: () => Promise<T>) {
    try {
      return await work();
    } catch (error) {
      if (error instanceof HttpException) throw error;
      Logger.error("TOWNBASE_AGENT_SETTINGS_FAILED");
      throw new HttpException({ code: "agent_unavailable" }, 503);
    }
  }
  @Get()
  @Header("Cache-Control", "no-store")
  snapshot(@Req() req: AccessRequest) {
    return this.handle(() =>
      this.agents.snapshot(readSessionCookie(req), this.access.requester(req)),
    );
  }
  @Put()
  @Header("Cache-Control", "no-store")
  configure(@Req() req: AccessRequest, @Body() body: unknown) {
    if (!fields(body, [...AGENT_FIELDS, "currentPassword", "expectedRevision"]))
      throw new HttpException({ code: "invalid_request" }, 400);
    const { currentPassword, expectedRevision, ...config } = body;
    if (
      !validAgentConfiguration(config) ||
      typeof expectedRevision !== "number" ||
      !Number.isInteger(expectedRevision) ||
      expectedRevision < 0 ||
      expectedRevision >= 2147483647
    )
      throw new HttpException({ code: "invalid_request" }, 400);
    return this.handle(async () => {
      const result = await this.agents.configure(
        readSessionCookie(req),
        currentPassword,
        this.access.requester(req),
        expectedRevision,
        config,
      );
      if (!result.ok)
        throw new HttpException(
          { code: result.code },
          result.code === "throttled"
            ? 429
            : result.code === "invalid_request"
              ? 400
              : 401,
        );
      const { ok: _ok, ...value } = result;
      void _ok;
      return value;
    });
  }
}
