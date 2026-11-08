import { OperationsModule } from "../operations/operations.module";
import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AgentModule } from "../agent/agent.module";
import { FilesModule } from "../files/files.module";
import { ModelIntegrationModule } from "../model-integration/model-integration.module";
import { AttachmentStore } from "./attachment-store";
import { AttachmentService } from "./attachment.service";
import { AttachmentController } from "./attachment.controller";
@Module({
  imports: [
    AuthModule,
    AgentModule,
    FilesModule,
    ModelIntegrationModule,
    OperationsModule,
  ],
  providers: [AttachmentStore, AttachmentService],
  controllers: [AttachmentController],
  exports: [AttachmentStore],
})
export class AttachmentsModule {}
