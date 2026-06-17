import { Module } from "@nestjs/common";

import { HealthController } from "./health.controller";
import {
  CliConnectorSyncRunner,
  CONNECTOR_SYNC_RUNNER,
} from "./ingestion/connector-runner";
import { IngestionController } from "./ingestion/ingestion.controller";
import { IngestionService } from "./ingestion/ingestion.service";

@Module({
  controllers: [HealthController, IngestionController],
  providers: [
    IngestionService,
    {
      provide: CONNECTOR_SYNC_RUNNER,
      useClass: CliConnectorSyncRunner,
    },
  ],
})
export class AppModule {}
