import "reflect-metadata";

import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module";
import { parsePort } from "./port";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    logger: ["error", "warn", "log"],
  });

  const port = parsePort(process.env.PORT);

  await app.listen(port);
  Logger.log(`townbase API listening on port ${port}`);
}

void bootstrap();
