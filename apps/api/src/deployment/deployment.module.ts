import { Module } from "@nestjs/common";
import { HealthController } from "../health.controller";
import { DeploymentDatabase } from "./deployment-database";
import { ReadinessController } from "./readiness.controller";
import { SetupController } from "../setup/setup.controller";
import { SetupService } from "../setup/setup.service";

// Intentionally excludes the legacy ingestion, MCP, gap and draft modules.
@Module({
  controllers: [HealthController, ReadinessController, SetupController],
  providers: [DeploymentDatabase, SetupService],
})
export class DeploymentModule {}
