import { Module } from "@nestjs/common";
import { HealthController } from "../health.controller";
import { DeploymentDatabase } from "./deployment-database";
import { ReadinessController } from "./readiness.controller";
import { SetupController } from "../setup/setup.controller";
import { SetupService } from "../setup/setup.service";

import { AuthService } from "../auth/auth.service";
import { AuthController } from "../auth/auth.controller";

// Intentionally excludes the legacy ingestion, MCP, gap and draft modules.
@Module({
  controllers: [
    HealthController,
    ReadinessController,
    SetupController,
    AuthController,
  ],
  providers: [DeploymentDatabase, SetupService, AuthService],
})
export class DeploymentModule {}
