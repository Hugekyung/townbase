import { Module } from "@nestjs/common";

import { HealthController } from "./health.controller";
import { ChatModule } from "./chat/chat.module";
import { KnowledgeGapsModule } from "./knowledge-gaps/knowledge-gaps.module";
import {
  CliConnectorSyncRunner,
  CONNECTOR_SYNC_RUNNER,
} from "./ingestion/connector-runner";
import { IngestionController } from "./ingestion/ingestion.controller";
import { IngestionService } from "./ingestion/ingestion.service";

@Module({
  imports: [ChatModule, KnowledgeGapsModule],
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
