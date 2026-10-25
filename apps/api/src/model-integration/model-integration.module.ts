import { OpenAIProvider } from "./openai-provider";
import { ModelExecutionService } from "./model-execution.service";
import { ModelExecutionController } from "./model-execution.controller";
import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { CredentialVault } from "./credential-vault";
import { ModelIntegrationService } from "./model-integration.service";
import { ModelIntegrationController } from "./model-integration.controller";
@Module({
  imports: [AuthModule],
  controllers: [ModelIntegrationController, ModelExecutionController],
  providers: [
    CredentialVault,
    ModelIntegrationService,
    ModelExecutionService,
    OpenAIProvider,
  ],
  exports: [ModelIntegrationService, ModelExecutionService],
})
export class ModelIntegrationModule {}
