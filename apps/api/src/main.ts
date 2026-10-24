import "reflect-metadata";

import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { access } from "node:fs/promises";
import path from "node:path";

import { DeploymentModule } from "./deployment/deployment.module";
import {
  configureSelfHostedHttp,
  configureSelfHostedStaticAssets,
} from "./deployment/self-hosted-http";
import { parsePort } from "./port";
import { resolveRuntimeProfile } from "./runtime-profile";
import { startupFailure, type StartupStage } from "./startup-failure";

let startupStage: StartupStage = "runtime-profile";

async function bootstrap(): Promise<void> {
  const profile = resolveRuntimeProfile(process.env);
  startupStage = "module-loading";
  const rootModule =
    profile === "self_hosted"
      ? DeploymentModule
      : (await import("./app.module")).AppModule;
  startupStage = "application";
  const app = await NestFactory.create<NestExpressApplication>(rootModule, {
    logger: ["error", "warn", "log"],
    bodyParser: profile !== "self_hosted",
  });
  app.enableShutdownHooks();

  if (profile === "self_hosted") {
    configureSelfHostedHttp(app);
    startupStage = "web-artifacts";
    const webRoot = path.resolve(__dirname, "../../web/dist");
    await access(path.join(webRoot, "index.html"));
    configureSelfHostedStaticAssets(app, webRoot);
  }

  startupStage = "port-configuration";
  const port = parsePort(process.env.PORT);

  startupStage = "listen";
  await app.listen(port, process.env.HOST ?? "127.0.0.1");
  Logger.log(`townbase API listening on port ${port}`);
}

void bootstrap().catch((error: unknown) => {
  Logger.error(startupFailure(startupStage, error));
  process.exit(1);
});
