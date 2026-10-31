import path from "node:path";
import { ModelIntegrationModule } from "../model-integration/model-integration.module";
import { FileIndexService } from "./file-index.service";
import { Module } from "@nestjs/common";
import { FileRunService } from "./file-run.service";
import { FileRunController } from "./file-run.controller";
import { AuthModule } from "../auth/auth.module";
import { AuthService } from "../auth/auth.service";
import { DeploymentDatabase } from "../deployment/deployment-database";
import { FileStorage } from "./file-storage";
import { FileExtractor } from "./file-extractor";
import { FileManagementService } from "./file-management.service";
import { FileManagementController } from "./file-management.controller";

@Module({
  imports: [AuthModule, ModelIntegrationModule],
  exports: [FileIndexService],
  controllers: [FileManagementController, FileRunController],
  providers: [
    {
      provide: FileStorage,
      useFactory: () =>
        new FileStorage(
          path.join(
            process.env.TOWNBASE_DOCUMENTS_PATH ??
              "/var/lib/townbase/documents",
            "originals",
          ),
        ),
    },
    FileExtractor,
    FileRunService,
    FileIndexService,
    {
      provide: FileManagementService,
      useFactory: (
        db: DeploymentDatabase,
        auth: AuthService,
        storage: FileStorage,
        extractor: FileExtractor,
      ) => new FileManagementService(db, auth, storage, extractor),
      inject: [DeploymentDatabase, AuthService, FileStorage, FileExtractor],
    },
  ],
})
export class FilesModule {}
