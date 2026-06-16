import { readFile } from "node:fs/promises";

import type { NotionSyncInput, NotionSyncFailure } from "./sync";

export type NotionSyncFixture = Readonly<
  NotionSyncInput & {
    workspaceName: string;
    dataSourceName: string;
    rootPageId: string;
    failures: ReadonlyArray<NotionSyncFailure>;
  }
>;

const asString = (value: unknown, fallback: string): string =>
  typeof value === "string" && value.trim() !== "" ? value : fallback;

const asFailures = (value: unknown): NotionSyncFailure[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(
      (entry): entry is NotionSyncFailure =>
        typeof entry === "object" && entry !== null && "pageId" in entry && "reason" in entry,
    )
    .map((entry) => {
      const failure: NotionSyncFailure = {
        pageId: asString(entry.pageId, "unknown-page"),
        reason: asString(entry.reason, "Unknown error"),
      };

      if ("pageTitle" in entry && typeof entry.pageTitle === "string") {
        return {
          ...failure,
          pageTitle: entry.pageTitle,
        };
      }

      return failure;
    });
};

export const loadNotionSyncFixture = async (fixturePath: string): Promise<NotionSyncFixture> => {
  const raw = await readFile(fixturePath, "utf8");
  const parsed: unknown = JSON.parse(raw);

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Notion sync fixture must be a JSON object");
  }

  const fixture = parsed as Record<string, unknown>;

  return {
    workspaceId: asString(fixture.workspaceId, "townbase"),
    dataSourceId: asString(fixture.dataSourceId, "notion-source"),
    syncedAt: new Date(asString(fixture.syncedAt, "2024-01-10T00:00:00.000Z")),
    pages: Array.isArray(fixture.pages) ? (fixture.pages as NotionSyncInput["pages"]) : [],
    failures: asFailures(fixture.failures),
    workspaceName: asString(fixture.workspaceName, "townbase"),
    dataSourceName: asString(fixture.dataSourceName, "notion-connector"),
    rootPageId: asString(fixture.rootPageId, "root-page"),
  };
};
