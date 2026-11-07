import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AgentModule } from "../agent/agent.module";
import { FilesModule } from "../files/files.module";
import { ModelIntegrationModule } from "../model-integration/model-integration.module";
import { RagController } from "./rag.controller";
import { RagStore } from "./rag-store";
import { RagService } from "./rag.service";
@Module({
  imports: [AuthModule, AgentModule, FilesModule, ModelIntegrationModule],
  controllers: [RagController],
  providers: [RagStore, RagService],
})
export class RagModule {}
