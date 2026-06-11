import "reflect-metadata";

import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module";

const DEFAULT_PORT = 3000;

function parsePort(rawPort: string | undefined): number {
  if (rawPort === undefined || rawPort.trim().length === 0) {
    return DEFAULT_PORT;
  }

  const parsedPort = Number(rawPort);

  if (!Number.isInteger(parsedPort) || parsedPort <= 0) {
    throw new Error(`Invalid PORT value: ${rawPort}`);
  }

  return parsedPort;
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    logger: ["error", "warn", "log"],
  });

  const port = parsePort(process.env.PORT);

  await app.listen(port);
  Logger.log(`townbase API listening on port ${port}`);
}

void bootstrap();
