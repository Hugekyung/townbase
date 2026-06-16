import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  collectSelectedLocalRepoFiles,
  isExcludedLocalRepoPath,
  isIncludedLocalRepoPath,
  mapLocalRepoFileToDocumentDraft,
} from "../src/local-repo";

describe("local repo scanner", () => {
  it("includes only document files from selected repositories and excludes sensitive paths", async () => {
    const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "tmp-local-repo-"));

    await fs.mkdir(path.join(rootPath, "repo-a", "docs"), { recursive: true });
    await fs.mkdir(path.join(rootPath, "repo-a", "docs", "logs"), { recursive: true });
    await fs.mkdir(path.join(rootPath, "repo-a", "docs", "secrets"), { recursive: true });
    await fs.mkdir(path.join(rootPath, "repo-a", "node_modules"), { recursive: true });
    await fs.mkdir(path.join(rootPath, "repo-a", ".git"), { recursive: true });
    await fs.mkdir(path.join(rootPath, "repo-a", "secrets"), { recursive: true });
    await fs.mkdir(path.join(rootPath, "repo-b", "docs"), { recursive: true });

    await fs.writeFile(path.join(rootPath, "repo-a", "README.md"), "# Repo A\n");
    await fs.writeFile(path.join(rootPath, "repo-a", "docs", "guide.md"), "# Guide\n");
    await fs.writeFile(path.join(rootPath, "repo-a", "docs", "logs", "activity.md"), "# Ignore\n");
    await fs.writeFile(path.join(rootPath, "repo-a", "docs", "secrets", "keys.md"), "# Ignore\n");
    await fs.writeFile(path.join(rootPath, "repo-a", "node_modules", "ignored.md"), "# Ignore\n");
    await fs.writeFile(path.join(rootPath, "repo-a", ".git", "config"), "[core]\n");
    await fs.writeFile(path.join(rootPath, "repo-a", "secrets", "key.pem"), "secret\n");
    await fs.writeFile(path.join(rootPath, "repo-b", "README.md"), "# Repo B\n");
    await fs.writeFile(path.join(rootPath, "repo-b", "docs", "other.md"), "# Other\n");

    const files = await collectSelectedLocalRepoFiles(rootPath, ["repo-a"]);

    expect(
      files.map((file) => ({
        repoName: file.repoName,
        filePath: file.filePath,
        content: file.content,
      })),
    ).toEqual([
      {
        repoName: "repo-a",
        filePath: "docs/guide.md",
        content: "# Guide\n",
      },
      {
        repoName: "repo-a",
        filePath: "README.md",
        content: "# Repo A\n",
      },
    ]);
    expect(isIncludedLocalRepoPath("docs/guide.md")).toBe(true);
    expect(isExcludedLocalRepoPath("node_modules/ignored.md")).toBe(true);
    expect(isExcludedLocalRepoPath("docs/logs/activity.md")).toBe(true);
    expect(isExcludedLocalRepoPath("docs/secrets/keys.md")).toBe(true);

    await fs.rm(rootPath, { recursive: true, force: true });
  });

  it("rejects dot repositories before scanning", async () => {
    const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "tmp-local-repo-"));

    await expect(collectSelectedLocalRepoFiles(rootPath, ["."])).rejects.toThrow(
      "Invalid selected repository name: .",
    );
    await expect(collectSelectedLocalRepoFiles(rootPath, [".."])).rejects.toThrow(
      "Invalid selected repository name: ..",
    );

    await fs.rm(rootPath, { recursive: true, force: true });
  });

  it("maps repo files into classified document drafts", () => {
    const draft = mapLocalRepoFileToDocumentDraft({
      workspaceId: "workspace-1",
      dataSourceId: "source-1",
      file: {
        repoName: "repo-a",
        filePath: "architecture/platform-overview.md",
        content: "# Platform\n",
        createdAt: new Date("2024-01-01T00:00:00.000Z"),
        modifiedAt: new Date("2024-01-03T01:02:03.000Z"),
      },
    });

    expect(draft).toMatchObject({
      workspaceId: "workspace-1",
      dataSourceId: "source-1",
      externalId: "repo-a:architecture/platform-overview.md",
      sourceType: "repo_docs",
      title: "platform-overview",
      url: null,
      filePath: "architecture/platform-overview.md",
      repoName: "repo-a",
      status: "active",
      knowledgeTypes: ["architecture"],
      domainTags: [],
      externalCreatedAt: new Date("2024-01-01T00:00:00.000Z"),
      externalUpdatedAt: new Date("2024-01-03T01:02:03.000Z"),
    });
    expect(draft.metadata).toEqual({
      classifierVersion: "phase2-v1",
      matchedRules: ["path:architecture"],
      filePath: "architecture/platform-overview.md",
      repoName: "repo-a",
      modifiedAt: "2024-01-03T01:02:03.000Z",
    });
  });
});
