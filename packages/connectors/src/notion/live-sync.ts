import { Client } from "@notionhq/client";
import type { Logger } from "@notionhq/client/build/src/logging";

import { normalizeLiveNotionPageRecord } from "./live-page";
import {
  loadNotionDatabaseRootSnapshots,
  loadNotionPageSnapshot,
  type NotionPageSnapshot,
} from "./traverse";
import type {
  NotionBlockRecord,
  NotionClientLike,
  NotionDatabaseRecord,
  NotionDatabaseRowRecord,
} from "./types";

type NotionSyncPageInput = Readonly<{
  page: NotionPageSnapshot["page"];
  content: string;
  pathSegments: ReadonlyArray<string>;
  archived?: boolean;
}>;

type NotionRootKind = "page" | "database";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const shouldFallbackToDatabase = (error: unknown): boolean => {
  if (!isRecord(error)) {
    return false;
  }

  if (typeof error.status === "number" && error.status === 404) {
    return true;
  }

  return (
    typeof error.code === "string" &&
    error.code === "validation_error" &&
    typeof error.message === "string" &&
    error.message.includes("database, not a page")
  );
};

const silentNotionLogger: Logger = () => {};

type SyncProgressLogger = Readonly<{
  info: (message: string) => void;
}>;

const createLiveNotionClient = (auth: string, silent: boolean): NotionClientLike => {
  const notionClient = new Client({
    auth,
    ...(silent ? { logger: silentNotionLogger } : {}),
  });

  return {
    pages: {
      retrieve: async ({ page_id }) => {
        const page = (await notionClient.pages.retrieve({
          page_id,
        })) as {
          object: string;
          id: string;
          url: string;
          created_time: string;
          last_edited_time: string;
          properties: Record<string, unknown>;
        };

        if (page.object !== "page") {
          throw new Error(`Notion page ${page_id} did not resolve to a page object`);
        }

        return normalizeLiveNotionPageRecord(page);
      },
    },
    blocks: {
      children: {
        list: async ({ block_id, start_cursor }) => {
          const response = await notionClient.blocks.children.list({
            block_id,
            ...(start_cursor === undefined ? {} : { start_cursor }),
          });

          return {
            results: response.results as ReadonlyArray<NotionBlockRecord>,
            next_cursor: response.next_cursor,
            has_more: response.has_more,
          };
        },
      },
    },
    databases: {
      retrieve: async ({ database_id }) => {
        const database = (await notionClient.databases.retrieve({
          database_id,
        })) as {
          object: string;
          id: string;
          title: ReadonlyArray<{ plain_text: string }>;
          properties: Record<string, { type?: string; [key: string]: unknown }>;
        };

        if (database.object !== "database") {
          throw new Error(`Notion database ${database_id} did not resolve to a database object`);
        }

        return {
          id: database.id,
          title: database.title,
          properties: database.properties as NotionDatabaseRecord["properties"],
        };
      },
      query: async ({ database_id, start_cursor }) => {
        const response = await notionClient.databases.query({
          database_id,
          ...(start_cursor === undefined ? {} : { start_cursor }),
        });

        return {
          results: response.results as ReadonlyArray<NotionDatabaseRowRecord>,
          next_cursor: response.next_cursor,
          has_more: response.has_more,
        };
      },
    },
  };
};

const flattenNotionPageSnapshots = (
  snapshot: NotionPageSnapshot,
  pathSegments: ReadonlyArray<string> = [],
): ReadonlyArray<NotionSyncPageInput> => [
  {
    page: snapshot.page,
    content: snapshot.content,
    pathSegments,
  },
  ...snapshot.childPages.flatMap((childPage) =>
    flattenNotionPageSnapshots(childPage, [...pathSegments, snapshot.page.title]),
  ),
];

const detectLiveNotionRootKind = async (
  client: NotionClientLike,
  rootId: string,
): Promise<NotionRootKind> => {
  try {
    await client.pages.retrieve({ page_id: rootId });
    return "page";
  } catch (pageError: unknown) {
    if (!shouldFallbackToDatabase(pageError)) {
      throw pageError;
    }

    if (client.databases !== undefined) {
      try {
        await client.databases.retrieve({ database_id: rootId });
        return "database";
      } catch (databaseError: unknown) {
        const reason =
          databaseError instanceof Error ? databaseError.message : "Unknown database root error";
        throw new Error(`Notion root ${rootId} did not resolve to a page or database: ${reason}`);
      }
    }

    const reason = pageError instanceof Error ? pageError.message : "Unknown page root error";
    throw new Error(`Notion root ${rootId} did not resolve to a page: ${reason}`);
  }
};

export const loadNotionSyncPagesFromClient = async (
  client: NotionClientLike,
  rootId: string,
): Promise<ReadonlyArray<NotionSyncPageInput>> => {
  const rootKind = await detectLiveNotionRootKind(client, rootId);

  if (rootKind === "page") {
    const snapshot = await loadNotionPageSnapshot(client, rootId);
    return flattenNotionPageSnapshots(snapshot);
  }

  const { databaseTitle, rowSnapshots } = await loadNotionDatabaseRootSnapshots(client, rootId);
  return rowSnapshots.flatMap((snapshot) => flattenNotionPageSnapshots(snapshot, [databaseTitle]));
};

export const loadLiveNotionSyncPages = async (
  notionApiKey: string,
  rootPageId: string,
  logger: SyncProgressLogger = {
    info: (message: string) => {
      process.stdout.write(`${message}\n`);
    },
  },
): Promise<ReadonlyArray<NotionSyncPageInput>> => {
  const detectionClient = createLiveNotionClient(notionApiKey, true);
  const client = createLiveNotionClient(notionApiKey, false);
  const rootKind = await detectLiveNotionRootKind(detectionClient, rootPageId);

  if (rootKind === "page") {
    logger.info(`Notion sync: reading page root ${rootPageId}`);
    const snapshot = await loadNotionPageSnapshot(client, rootPageId, new Set<string>(), logger);
    logger.info(`Notion sync: flattened page root ${snapshot.page.title}`);
    return flattenNotionPageSnapshots(snapshot);
  }

  logger.info(`Notion sync: reading database root ${rootPageId}`);
  const { databaseTitle, rowSnapshots } = await loadNotionDatabaseRootSnapshots(client, rootPageId, logger);
  logger.info(`Notion sync: database root ${databaseTitle} returned ${rowSnapshots.length} rows`);
  return rowSnapshots.flatMap((snapshot) => flattenNotionPageSnapshots(snapshot, [databaseTitle]));
};
