import { Module } from "@nestjs/common";

import { createPrismaClient } from "@townbase/database";

import { KnowledgeGapsController } from "./knowledge-gaps.controller";
import { KnowledgeGapsService } from "./knowledge-gaps.service";

@Module({
  controllers: [KnowledgeGapsController],
  providers: [
    {
      provide: KnowledgeGapsService,
      useFactory: () => new KnowledgeGapsService(createPrismaClient()),
    },
  ],
  exports: [KnowledgeGapsService],
})
export class KnowledgeGapsModule {}
