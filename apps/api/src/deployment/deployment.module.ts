import { Module } from "@nestjs/common";
import { HealthController } from "../health.controller";
import { ReadinessController } from "./readiness.controller";
import { SetupController } from "../setup/setup.controller";
import { SetupService } from "../setup/setup.service";

import { ModelIntegrationModule } from "../model-integration/model-integration.module";
import { FilesModule } from "../files/files.module";
import { AuthModule } from "../auth/auth.module";

// Intentionally excludes the legacy ingestion, MCP, gap and draft modules.
@Module({
  imports: [AuthModule, ModelIntegrationModule, FilesModule],
  controllers: [HealthController, ReadinessController, SetupController],
  providers: [SetupService],
})
export class DeploymentModule {}
