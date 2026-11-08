import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DeletionJournal } from "./deletion-journal";
import { OperationsService } from "./operations.service";
import { OperationsController } from "./operations.controller";
@Module({
  imports: [AuthModule],
  providers: [DeletionJournal, OperationsService],
  controllers: [OperationsController],
  exports: [DeletionJournal],
})
export class OperationsModule {}
