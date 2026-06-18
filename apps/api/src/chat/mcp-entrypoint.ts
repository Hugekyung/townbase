import "reflect-metadata";

import { NestFactory } from "@nestjs/core";

import { ChatModule } from "./chat.module";
import { ChatMcpServer } from "./chat.server";

export async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(ChatModule, {
    logger: false,
  });

  const server = app.get(ChatMcpServer);
  await server.startStdio();
}

if (require.main === module) {
  void bootstrap();
}
