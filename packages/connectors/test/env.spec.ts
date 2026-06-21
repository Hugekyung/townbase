import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  loadConnectorWorkspaceEnv,
  loadLocalRepoConnectorEnv,
  loadNotionConnectorEnv,
} from "../src/env";

const restoreEnvVar = (name: string, value: string | undefined): void => {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
};

describe("loadNotionConnectorEnv", () => {
  it("loads env vars from a workspace env file when they are missing", () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "townbase-env-"));
    const envFilePath = path.join(workspaceDir, ".env");
    const originalApiKey = process.env.NOTION_API_KEY;
    const originalRootPageId = process.env.NOTION_ROOT_PAGE_ID;

    delete process.env.NOTION_API_KEY;
    delete process.env.NOTION_ROOT_PAGE_ID;
    fs.writeFileSync(
      envFilePath,
      ["NOTION_API_KEY=secret-api-key", "NOTION_ROOT_PAGE_ID=root-page-id"].join("\n"),
    );

    loadConnectorWorkspaceEnv(envFilePath);

    expect(loadNotionConnectorEnv()).toEqual({
      notionApiKey: "secret-api-key",
      notionRootPageId: "root-page-id",
    });

    restoreEnvVar("NOTION_API_KEY", originalApiKey);
    restoreEnvVar("NOTION_ROOT_PAGE_ID", originalRootPageId);
  });

  it("throws when the Notion env vars are missing", () => {
    const originalApiKey = process.env.NOTION_API_KEY;
    const originalRootPageId = process.env.NOTION_ROOT_PAGE_ID;

    delete process.env.NOTION_API_KEY;
    delete process.env.NOTION_ROOT_PAGE_ID;

    expect(() => loadNotionConnectorEnv()).toThrow(
      "Missing required environment variable: NOTION_API_KEY",
    );

    restoreEnvVar("NOTION_API_KEY", originalApiKey);
    restoreEnvVar("NOTION_ROOT_PAGE_ID", originalRootPageId);
  });

  it("loads the Notion env vars when they are present", () => {
    process.env.NOTION_API_KEY = "secret-api-key";
    process.env.NOTION_ROOT_PAGE_ID = "root-page-id";

    expect(loadNotionConnectorEnv()).toEqual({
      notionApiKey: "secret-api-key",
      notionRootPageId: "root-page-id",
    });
  });

  it("loads the local repo root path with a default fallback", () => {
    const originalRepoRootPath = process.env.REPO_ROOT_PATH;

    delete process.env.REPO_ROOT_PATH;
    expect(loadLocalRepoConnectorEnv()).toEqual({
      repoRootPath: "./repos",
    });

    process.env.REPO_ROOT_PATH = "/tmp/repos";
    expect(loadLocalRepoConnectorEnv()).toEqual({
      repoRootPath: "/tmp/repos",
    });

    restoreEnvVar("REPO_ROOT_PATH", originalRepoRootPath);
  });
});
