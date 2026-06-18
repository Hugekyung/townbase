import "reflect-metadata";

import { NestFactory } from "@nestjs/core";

import { ChatModule } from "./chat.module";
import { ChatMcpServer } from "./chat.server";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(ChatModule, {
    logger: ["error", "warn", "log"],
  });

  const server = app.get(ChatMcpServer);
  await server.startStdio();
}

void bootstrap();
