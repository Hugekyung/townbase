import { Module } from "@nestjs/common";

import { createPrismaClient, assertLegacyDevelopment } from "@townbase/database";

import { KnowledgeGapsController } from "./knowledge-gaps.controller";
import { KnowledgeGapsService } from "./knowledge-gaps.service";

@Module({
  controllers: [KnowledgeGapsController],
  providers: [
    {
      provide: KnowledgeGapsService,
      useFactory: () => { assertLegacyDevelopment(); return new KnowledgeGapsService(createPrismaClient()); },
    },
  ],
  exports: [KnowledgeGapsService],
})
export class KnowledgeGapsModule {}
