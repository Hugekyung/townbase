import "reflect-metadata";

import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { access } from "node:fs/promises";
import path from "node:path";

import { DeploymentModule } from "./deployment/deployment.module";
import { parsePort } from "./port";
import { resolveRuntimeProfile } from "./runtime-profile";

async function bootstrap(): Promise<void> {
  const profile = resolveRuntimeProfile(process.env);
  const rootModule =
    profile === "self_hosted"
      ? DeploymentModule
      : (await import("./app.module")).AppModule;
  const app = await NestFactory.create<NestExpressApplication>(rootModule, {
    logger: ["error", "warn", "log"],
  });
  app.enableShutdownHooks();

  if (profile === "self_hosted") {
    const webRoot = path.resolve(__dirname, "../../web/dist");
    await access(path.join(webRoot, "index.html"));
    app.use(
      (
        _request: unknown,
        response: { setHeader(name: string, value: string): void },
        next: () => void,
      ) => {
        response.setHeader("X-Content-Type-Options", "nosniff");
        response.setHeader("Referrer-Policy", "no-referrer");
        response.setHeader(
          "Content-Security-Policy",
          "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
        );
        next();
      },
    );
    app.useStaticAssets(webRoot, { dotfiles: "deny", index: "index.html" });
  }

  const port = parsePort(process.env.PORT);

  await app.listen(port, process.env.HOST ?? "127.0.0.1");
  Logger.log(`townbase API listening on port ${port}`);
}

void bootstrap().catch(() => {
  Logger.error(
    "Townbase startup failed. Check runtime profile, web build and deployment configuration.",
  );
  process.exit(1);
});
