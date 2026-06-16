import fs from "node:fs/promises";
import path from "node:path";

import type { LocalRepoFileSnapshot } from "./types";

const normalizePath = (value: string): string => value.replaceAll("\\", "/").replace(/^\.\/+/, "").toLowerCase();

const hasExcludedSegment = (segments: ReadonlyArray<string>, target: string): boolean =>
  segments.includes(target);

const isExcludedLocalRepoPath = (relativePath: string): boolean => {
  const normalizedPath = normalizePath(relativePath);
  const segments = normalizedPath.split("/");
  const basename = segments.at(-1) ?? normalizedPath;

  return (
    hasExcludedSegment(segments, ".git") ||
    hasExcludedSegment(segments, "node_modules") ||
    hasExcludedSegment(segments, "dist") ||
    hasExcludedSegment(segments, "build") ||
    hasExcludedSegment(segments, "secrets") ||
    hasExcludedSegment(segments, "logs") ||
    basename.startsWith(".env") ||
    basename.endsWith(".pem") ||
    basename.endsWith(".key")
  );
};

const isIncludedLocalRepoPath = (relativePath: string): boolean => {
  const normalizedPath = normalizePath(relativePath);
  const segments = normalizedPath.split("/");
  const basename = segments.at(-1) ?? normalizedPath;

  return (
    (segments.length === 1 && basename === "readme.md") ||
    (normalizedPath.startsWith("docs/") && normalizedPath.endsWith(".md")) ||
    (normalizedPath.startsWith("adr/") && normalizedPath.endsWith(".md")) ||
    (normalizedPath.startsWith("architecture/") && normalizedPath.endsWith(".md")) ||
    (normalizedPath.startsWith("prd/") && normalizedPath.endsWith(".md")) ||
    normalizedPath === ".github/pull_request_template.md" ||
    (normalizedPath.startsWith(".github/issue_template/") && normalizedPath.endsWith(".md")) ||
    basename === "schema.prisma" ||
    ((normalizedPath.startsWith("migrations/") || normalizedPath.includes("/migrations/")) &&
      normalizedPath.endsWith(".sql"))
  );
};

const assertValidRepositoryName = (repoName: string): void => {
  if (
    repoName.trim() === "" ||
    repoName === "." ||
    repoName === ".." ||
    repoName.includes("/") ||
    repoName.includes("\\")
  ) {
    throw new Error(`Invalid selected repository name: ${repoName}`);
  }
};

const walkRepository = async (
  repoRootPath: string,
  currentPath: string,
  repoName: string,
  snapshots: LocalRepoFileSnapshot[],
): Promise<void> => {
  const entries = await fs.readdir(currentPath, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    const absolutePath = path.join(currentPath, entry.name);
    const relativePath = path.relative(repoRootPath, absolutePath).replaceAll(path.sep, "/");

    if (isExcludedLocalRepoPath(relativePath)) {
      continue;
    }

    if (entry.isDirectory()) {
      await walkRepository(repoRootPath, absolutePath, repoName, snapshots);
      continue;
    }

    if (!entry.isFile() || !isIncludedLocalRepoPath(relativePath)) {
      continue;
    }

    const [content, stats] = await Promise.all([
      fs.readFile(absolutePath, "utf8"),
      fs.stat(absolutePath),
    ]);

    snapshots.push({
      repoName,
      filePath: relativePath,
      content,
      createdAt: stats.birthtime,
      modifiedAt: stats.mtime,
    });
  }
};

export const collectSelectedLocalRepoFiles = async (
  repoRootPath: string,
  selectedRepoNames: ReadonlyArray<string>,
): Promise<ReadonlyArray<LocalRepoFileSnapshot>> => {
  const snapshots: LocalRepoFileSnapshot[] = [];

  for (const repoName of selectedRepoNames) {
    assertValidRepositoryName(repoName);
    const repoPath = path.resolve(repoRootPath, repoName);
    const stats = await fs.stat(repoPath).catch(() => null);

    if (stats === null || !stats.isDirectory()) {
      throw new Error(`Missing selected repository directory: ${repoName}`);
    }

    await walkRepository(repoPath, repoPath, repoName, snapshots);
  }

  snapshots.sort((left, right) =>
    left.repoName === right.repoName
      ? left.filePath.localeCompare(right.filePath)
      : left.repoName.localeCompare(right.repoName),
  );

  return snapshots;
};

export { isExcludedLocalRepoPath, isIncludedLocalRepoPath };
