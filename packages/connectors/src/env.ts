import fs from "node:fs";
import path from "node:path";

export type NotionConnectorEnv = Readonly<{
  notionApiKey: string;
  notionRootPageId: string;
}>;

export type LocalRepoConnectorEnv = Readonly<{
  repoRootPath: string;
}>;

const loadEnvFile = (envFilePath: string): void => {
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
};

export const loadConnectorWorkspaceEnv = (envFilePath: string): void => {
  loadEnvFile(envFilePath);
};

loadEnvFile(path.resolve(__dirname, "../../../.env"));

const readRequiredEnvVar = (name: string): string => {
  const value = process.env[name];

  if (value === undefined || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
};

export const loadNotionConnectorEnv = (): NotionConnectorEnv => ({
  notionApiKey: readRequiredEnvVar("NOTION_API_KEY"),
  notionRootPageId: readRequiredEnvVar("NOTION_ROOT_PAGE_ID"),
});

export const loadLocalRepoConnectorEnv = (): LocalRepoConnectorEnv => ({
  repoRootPath: process.env.REPO_ROOT_PATH ?? "./repos",
});
