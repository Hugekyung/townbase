import {
  Controller,
  Get,
  Header,
  Req,
  ServiceUnavailableException,
  Logger,
  HttpException,
} from "@nestjs/common";
import { AccessService, type AccessRequest } from "../access/access.service";
import { readSessionCookie } from "../auth/auth-transport";
import { OperationsService } from "./operations.service";
@Controller("operations")
export class OperationsController {
  constructor(
    private readonly operations: OperationsService,
    private readonly access: AccessService,
  ) {}
  @Get() @Header("Cache-Control", "no-store") async snapshot(
    @Req() req: AccessRequest,
  ) {
    try {
      return await this.operations.snapshot(
        readSessionCookie(req),
        this.access.requester(req),
      );
    } catch (e) {
      if (e instanceof HttpException) throw e;
      Logger.error("TOWNBASE_OPERATIONS_UNAVAILABLE");
      throw new ServiceUnavailableException({ code: "operations_unavailable" });
    }
  }
}
