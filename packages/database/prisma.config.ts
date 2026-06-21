import fs from "node:fs";
import path from "node:path";

import { defineConfig, env } from "prisma/config";

function loadEnvFile(envFilePath: string): void {
  if (!fs.existsSync(envFilePath)) {
    return;
  }

  const fileContents = fs.readFileSync(envFilePath, "utf8");

  for (const rawLine of fileContents.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    if (!key || process.env[key] !== undefined) {
      continue;
    }

    let value = line.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

loadEnvFile(path.resolve(__dirname, "../../.env"));

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "ts-node --project tsconfig.json prisma/seed.ts",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
