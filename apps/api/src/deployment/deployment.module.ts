import { Module } from "@nestjs/common";
import { HealthController } from "../health.controller";
import { DeploymentDatabase } from "./deployment-database";
import { ReadinessController } from "./readiness.controller";

// Intentionally excludes the legacy ingestion, MCP, gap and draft modules.
@Module({
  controllers: [HealthController, ReadinessController],
  providers: [DeploymentDatabase],
})
export class DeploymentModule {}
