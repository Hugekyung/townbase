import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { CredentialVault } from "./credential-vault";
import { ModelIntegrationService } from "./model-integration.service";
import { ModelIntegrationController } from "./model-integration.controller";
@Module({
  imports: [AuthModule],
  controllers: [ModelIntegrationController],
  providers: [CredentialVault, ModelIntegrationService],
  exports: [ModelIntegrationService],
})
export class ModelIntegrationModule {}
