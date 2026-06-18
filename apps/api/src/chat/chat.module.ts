import { Module } from "@nestjs/common";

import { ChatQuestionService } from "./chat.service";
import { ChatMcpServer } from "./chat.server";
import { ChatToolRegistry } from "./chat.registry";
import { createDefaultChatDependencies } from "./chat.runtime";

@Module({
  providers: [
    {
      provide: ChatQuestionService,
      useFactory: () => new ChatQuestionService(createDefaultChatDependencies()),
    },
    ChatToolRegistry,
    ChatMcpServer,
  ],
  exports: [ChatToolRegistry, ChatMcpServer],
})
export class ChatModule {}
