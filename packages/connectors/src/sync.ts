import { Client } from "@notionhq/client";
import path from "node:path";

import { loadNotionConnectorEnv } from "./env";
import { loadDatabaseRuntime } from "./database-runtime";
import { createOptionalEmbeddingModel } from "./embedding-model";
import { createPrismaNotionSyncStore } from "./notion/prisma-store";
import { loadNotionSyncFixture } from "./notion/fixture";
import {
  loadNotionDatabaseRootSnapshots,
  loadNotionPageSnapshot,
  type NotionPageSnapshot,
} from "./notion/traverse";
import type {
  NotionBlockRecord,
  NotionClientLike,
  NotionDatabaseRecord,
  NotionDatabaseRowRecord,
} from "./notion";
import { syncNotionPages, type NotionSyncSummary } from "./notion/sync";

type RunNotionSyncOptions = Readonly<{
  fixturePath?: string;
}>;

type DatabaseRuntimeModule = ReturnType<typeof loadDatabaseRuntime>;
type PrismaClientLike = ReturnType<DatabaseRuntimeModule["createPrismaClient"]>;
type NotionSyncPageInput = Readonly<{
  page: NotionPageSnapshot["page"];
  content: string;
  pathSegments: ReadonlyArray<string>;
  archived?: boolean;
}>;

type NotionRootKind = "page" | "database";

const resolveFixturePath = (fixturePath: string | undefined): string =>
  fixturePath === undefined
    ? path.resolve(__dirname, "..", "fixtures", "notion-sync.fixture.json")
    : path.isAbsolute(fixturePath)
      ? fixturePath
      : path.resolve(__dirname, "../../../", fixturePath);

const normalizeLiveNotionPageRecord = (page: {
  id: string;
  url: string;
  created_time: string;
  last_edited_time: string;
  properties: Record<string, unknown>;
}): {
  id: string;
  url: string;
  created_time: string;
  last_edited_time: string;
  properties: Readonly<{
    title: ReadonlyArray<{ plain_text: string }>;
  }>;
} => {
  const rawTitle = page.properties.title;

  if (!Array.isArray(rawTitle)) {
    return {
      id: page.id,
      url: page.url,
      created_time: page.created_time,
      last_edited_time: page.last_edited_time,
      properties: {
        title: [{ plain_text: "Untitled" }],
      },
    };
  }

  const title = rawTitle
    .filter(
      (segment): segment is { plain_text: string } =>
        typeof segment === "object" && segment !== null && "plain_text" in segment &&
        typeof (segment as { plain_text?: unknown }).plain_text === "string",
    )
    .map((segment) => segment.plain_text)
    .join("")
    .trim();

  return {
    id: page.id,
    url: page.url,
    created_time: page.created_time,
    last_edited_time: page.last_edited_time,
    properties: {
      title: [{ plain_text: title === "" ? "Untitled" : title }],
    },
  };
};

const createLiveNotionClient = (auth: string): NotionClientLike => {
  const notionClient = new Client({ auth });

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

export const flattenNotionPageSnapshots = (
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
  return rowSnapshots.flatMap((snapshot) =>
    flattenNotionPageSnapshots(snapshot, [databaseTitle]),
  );
};

const loadLiveNotionSyncPages = async (
  notionApiKey: string,
  rootPageId: string,
): Promise<ReadonlyArray<NotionSyncPageInput>> => {
  const client = createLiveNotionClient(notionApiKey);
  return loadNotionSyncPagesFromClient(client, rootPageId);
};

const upsertWorkspace = async (
  prisma: PrismaClientLike,
  workspaceName: string,
): Promise<string> => {
  const workspace = await prisma.workspace.upsert({
    where: {
      name: workspaceName,
    },
    update: {},
    create: {
      name: workspaceName,
    },
  });

  return workspace.id;
};

const upsertDataSource = async (
  prisma: PrismaClientLike,
  workspaceId: string,
  dataSourceName: string,
  rootPageId: string,
): Promise<string> => {
  const dataSource = await prisma.dataSource.upsert({
    where: {
      workspaceId_name: {
        workspaceId,
        name: dataSourceName,
      },
    },
    update: {
      type: "notion",
      rootPageId,
      config: {
        rootPageId,
        source: "phase3",
      },
    },
    create: {
      workspaceId,
      type: "notion",
      name: dataSourceName,
      rootPageId,
      config: {
        rootPageId,
        source: "phase3",
      },
    },
  });

  return dataSource.id;
};

export const runNotionSync = async (
  options: RunNotionSyncOptions = {},
): Promise<NotionSyncSummary> => {
  const env = loadNotionConnectorEnv();
  const database = loadDatabaseRuntime(path.resolve(__dirname, "..", "..", "database"));
  const prisma = database.createPrismaClient();
  const embeddingModel = createOptionalEmbeddingModel();
  const livePages = options.fixturePath === undefined
    ? await loadLiveNotionSyncPages(env.notionApiKey, env.notionRootPageId)
    : undefined;
  const fixture = options.fixturePath === undefined
    ? undefined
    : await loadNotionSyncFixture(resolveFixturePath(options.fixturePath));

  await prisma.$connect();

  try {
    const workspaceId = await upsertWorkspace(
      prisma,
      fixture?.workspaceName ?? database.DEFAULT_WORKSPACE_NAME,
    );
    const dataSourceId = await upsertDataSource(
      prisma,
      workspaceId,
      fixture?.dataSourceName ?? "notion-connector",
      fixture?.rootPageId ?? env.notionRootPageId,
    );

    const summary = await syncNotionPages(
      {
        workspaceId,
        dataSourceId,
        syncedAt: fixture?.syncedAt ?? new Date(),
        pages: fixture?.pages ?? livePages ?? [],
        ...(fixture === undefined || fixture.failures.length === 0 ? {} : { failures: fixture.failures }),
      },
      createPrismaNotionSyncStore(prisma, {
        workspaceId,
        dataSourceId,
        ...(embeddingModel === undefined ? {} : { embeddingModel }),
      }),
      {
        warn: (entry) => {
          process.stderr.write(
            `WARN ${entry.pageId}${entry.pageTitle === undefined ? "" : ` ${entry.pageTitle}`}: ${entry.reason}\n`,
          );
        },
      },
    );

    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return summary;
  } finally {
    await database.disconnectPrismaClient();
  }
};

const main = async (): Promise<void> => {
  await runNotionSync({
    ...(process.env.NOTION_SYNC_FIXTURE_PATH === undefined
      ? {}
      : { fixturePath: process.env.NOTION_SYNC_FIXTURE_PATH }),
  });
};

if (require.main === module) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown error";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
