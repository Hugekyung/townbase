import "reflect-metadata";

import path from "node:path";
import { writeSync } from "node:fs";

import { NestFactory } from "@nestjs/core";
import dotenv from "dotenv";

import { assertLegacyDevelopment } from "../runtime-profile";
import { mcpStartupFailure, type McpStartupStage } from "./mcp-startup-failure";
import { ChatModule } from "./chat.module";
import { ChatMcpServer } from "./chat.server";

dotenv.config({
  quiet: true,
  path: path.resolve(__dirname, "../../../../.env"),
  override: false,
});

let startupStage: McpStartupStage = "runtime-profile";

export async function bootstrap(): Promise<void> {
  startupStage = "runtime-profile";
  assertLegacyDevelopment();
  startupStage = "application";
  const app = await NestFactory.createApplicationContext(ChatModule, {
    logger: false,
    abortOnError: false,
  });

  const server = app.get(ChatMcpServer);
  startupStage = "transport";
  await server.startStdio();
}

if (require.main === module) {
  void bootstrap().catch((error: unknown) => {
    // Startup is fatal: partial Nest/stdio initialization may keep handles open.
    // Write synchronously so immediate termination cannot truncate the diagnostic.
    try {
      writeSync(
        process.stderr.fd,
        `${mcpStartupFailure(startupStage, error)}\n`,
      );
    } finally {
      process.exit(1);
    }
  });
}
