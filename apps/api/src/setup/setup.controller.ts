import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Post,
  Req,
  HttpException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { SetupService } from "./setup.service";
import { setupTransportAllowed, type SetupRequest } from "./setup-transport";

@Controller("setup")
export class SetupController {
  constructor(private readonly setup: SetupService) {}
  @Get("status")
  @Header("Cache-Control", "no-store")
  async status() {
    try {
      return await this.setup.status();
    } catch {
      throw new ServiceUnavailableException({ code: "setup_unavailable" });
    }
  }
  @Post("administrator")
  @HttpCode(201)
  @Header("Cache-Control", "no-store")
  async register(@Req() request: SetupRequest, @Body() body: unknown) {
    if (!setupTransportAllowed(request))
      throw new HttpException({ code: "setup_transport_denied" }, 403);
    if (
      typeof request.headers["content-type"] !== "string" ||
      !/^application\/json(?:\s*;|$)/i.test(request.headers["content-type"])
    )
      throw new HttpException({ code: "json_required" }, 415);
    let result;
    try {
      result = await this.setup.register(body);
    } catch {
      throw new ServiceUnavailableException({ code: "setup_unavailable" });
    }
    if (result !== "registered") {
      const codes = {
        closed: 409,
        invalid_request: 400,
        invalid_token: 401,
        throttled: 429,
      };
      throw new HttpException({ code: result }, codes[result]);
    }
    return { state: "complete", administratorCreated: true };
  }
}
