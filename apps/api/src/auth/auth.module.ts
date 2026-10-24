import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AccessService } from "../access/access.service";
import { AdministratorGuard } from "../access/administrator.guard";
import { DeploymentDatabase } from "../deployment/deployment-database";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
@Module({
  controllers: [AuthController],
  providers: [
    DeploymentDatabase,
    AuthService,
    AccessService,
    { provide: APP_GUARD, useClass: AdministratorGuard },
  ],
  exports: [DeploymentDatabase, AuthService, AccessService],
})
export class AuthModule {}
