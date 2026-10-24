import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AccessService, type AccessRequest } from "./access.service";
import { PUBLIC_ENDPOINT } from "./public-endpoint";
@Injectable()
export class AdministratorGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly access: AccessService,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (
      this.reflector.get<boolean>(PUBLIC_ENDPOINT, context.getHandler()) ===
      true
    )
      return true;
    await this.access.authenticate(
      context.switchToHttp().getRequest<AccessRequest>(),
    );
    return true;
  }
}
