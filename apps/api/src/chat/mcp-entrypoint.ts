import "reflect-metadata";

import path from "node:path";

import { NestFactory } from "@nestjs/core";
import dotenv from "dotenv";

import { ChatModule } from "./chat.module";
import { ChatMcpServer } from "./chat.server";

dotenv.config({
  path: path.resolve(__dirname, "../../../../.env"),
  override: false,
});

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
