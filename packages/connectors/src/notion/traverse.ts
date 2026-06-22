import { renderSupportedBlock } from "./render";
import type {
  NotionBlockRecord,
  NotionClientLike,
  NotionDatabaseRecord,
  NotionDatabaseRowRecord,
  NotionPageSnapshot,
  NotionPageRecord,
} from "./types";
export type {
  NotionBlockRecord,
  NotionClientLike,
  NotionDatabaseRecord,
  NotionDatabaseRowRecord,
  NotionPageSnapshot,
  NotionPageRecord,
} from "./types";

type RichTextSegment = Readonly<{
  plain_text: string;
}>;

type NotionTraversalLogger = Readonly<{
  info: (message: string) => void;
}>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const normalizeTitle = (value: string): string => {
  const title = value.trim();

  return title === "" ? "Untitled" : title;
};

const extractRichText = (
  value: ReadonlyArray<RichTextSegment> | undefined,
): string => {
  if (value === undefined) {
    return "";
  }

  return value.map((segment) => segment.plain_text).join("");
};

const extractPageTitle = (page: Pick<NotionPageRecord, "properties">): string =>
  normalizeTitle(extractRichText(page.properties.title));

const extractDatabaseTitleKey = (database: NotionDatabaseRecord): string => {
  const titleEntry = Object.entries(database.properties).find(
    ([, property]) => property.type === "title",
  );

  return titleEntry?.[0] ?? "title";
};

const extractDatabaseRowTitle = (
  database: NotionDatabaseRecord,
  row: NotionDatabaseRowRecord,
): string => {
  const titleKey = extractDatabaseTitleKey(database);
  const property = row.properties[titleKey];

  if (!isRecord(property) || !("title" in property) || !Array.isArray(property.title)) {
    return "Untitled";
  }

  return normalizeTitle(
    property.title
      .filter(
        (segment): segment is RichTextSegment =>
          isRecord(segment) && typeof segment.plain_text === "string",
      )
      .map((segment) => segment.plain_text)
      .join(""),
  );
};

const listAllChildBlocks = async (
  client: NotionClientLike,
  blockId: string,
): Promise<ReadonlyArray<NotionBlockRecord>> => {
  const blocks: NotionBlockRecord[] = [];
  let cursor: string | undefined;

  while (true) {
    const response = await client.blocks.children.list({
      block_id: blockId,
      ...(cursor === undefined ? {} : { start_cursor: cursor }),
    });

    blocks.push(...response.results);

    if (!response.has_more || response.next_cursor === null) {
      return blocks;
    }

    cursor = response.next_cursor;
  }
};

const collectPageChildren = async (
  client: NotionClientLike,
  pageId: string,
  visitedPageIds: ReadonlySet<string> = new Set<string>(),
  logger: NotionTraversalLogger = {
    info: () => {},
  },
): Promise<{
  contentLines: string[];
  childPages: NotionPageSnapshot[];
  unsupportedBlockIds: string[];
}> => {
  const nextVisitedPageIds = new Set(visitedPageIds);
  nextVisitedPageIds.add(pageId);
  const blocks = await listAllChildBlocks(client, pageId);
  const contentLines: string[] = [];
  const childPages: NotionPageSnapshot[] = [];
  const unsupportedBlockIds: string[] = [];

  for (const block of blocks) {
    if (block.type === "child_page") {
      if (!nextVisitedPageIds.has(block.id)) {
        childPages.push(await loadNotionPageSnapshot(client, block.id, nextVisitedPageIds, logger));
      }
      continue;
    }

    const rendered = renderSupportedBlock(block);

    if (rendered === null) {
      unsupportedBlockIds.push(block.id);
    } else if (rendered !== "") {
      contentLines.push(rendered);
    }

    if (block.has_children === true && !nextVisitedPageIds.has(block.id)) {
      const nested = await collectPageChildren(client, block.id, nextVisitedPageIds, logger);
      contentLines.push(...nested.contentLines);
      childPages.push(...nested.childPages);
      unsupportedBlockIds.push(...nested.unsupportedBlockIds);
    }
  }

  return {
    contentLines,
    childPages,
    unsupportedBlockIds,
  };
};

const buildPageSnapshot = async (
  client: NotionClientLike,
  page: NotionPageRecord,
  visitedPageIds: ReadonlySet<string>,
  logger: NotionTraversalLogger,
): Promise<NotionPageSnapshot> => {
  logger.info(`Notion sync: reading page ${extractPageTitle(page)} (${page.id})`);
  const children = await collectPageChildren(client, page.id, visitedPageIds, logger);

  return {
    page: {
      id: page.id,
      title: extractPageTitle(page),
      url: page.url,
      createdTime: page.created_time,
      lastEditedTime: page.last_edited_time,
    },
    content: children.contentLines.join("\n"),
    childPages: children.childPages,
    unsupportedBlockIds: children.unsupportedBlockIds,
  };
};

const listAllDatabaseRows = async (
  client: NotionClientLike,
  databaseId: string,
): Promise<ReadonlyArray<NotionDatabaseRowRecord>> => {
  if (client.databases === undefined) {
    throw new Error("Notion database operations are not supported by this client");
  }

  const rows: NotionDatabaseRowRecord[] = [];
  let cursor: string | undefined;

  while (true) {
    const response = await client.databases.query({
      database_id: databaseId,
      ...(cursor === undefined ? {} : { start_cursor: cursor }),
    });

    rows.push(...response.results);

    if (!response.has_more || response.next_cursor === null) {
      return rows;
    }

    cursor = response.next_cursor;
  }
};

const normalizeDatabaseRowToPageRecord = (
  database: NotionDatabaseRecord,
  row: NotionDatabaseRowRecord,
): NotionPageRecord => ({
  id: row.id,
  url: row.url,
  created_time: row.created_time,
  last_edited_time: row.last_edited_time,
  properties: {
    title: [{ plain_text: extractDatabaseRowTitle(database, row) }],
  },
});

export const loadNotionPageSnapshot = async (
  client: NotionClientLike,
  pageId: string,
  visitedPageIds: ReadonlySet<string> = new Set<string>(),
  logger: NotionTraversalLogger = {
    info: () => {},
  },
): Promise<NotionPageSnapshot> => {
  const page = await client.pages.retrieve({ page_id: pageId });
  const nextVisitedPageIds = new Set(visitedPageIds);
  nextVisitedPageIds.add(pageId);
  return buildPageSnapshot(client, page, nextVisitedPageIds, logger);
};

export const loadNotionDatabaseRootSnapshots = async (
  client: NotionClientLike,
  databaseId: string,
  logger: NotionTraversalLogger = {
    info: () => {},
  },
): Promise<{
  databaseTitle: string;
  rowSnapshots: ReadonlyArray<NotionPageSnapshot>;
}> => {
  if (client.databases === undefined) {
    throw new Error("Notion database operations are not supported by this client");
  }

  const database = await client.databases.retrieve({ database_id: databaseId });
  const databaseTitle = extractPageTitle({ properties: { title: database.title } });
  const rows = await listAllDatabaseRows(client, databaseId);
  const rowSnapshots: NotionPageSnapshot[] = [];

  for (const row of rows) {
    const rowPage = normalizeDatabaseRowToPageRecord(database, row);
    logger.info(`Notion sync: reading database row ${extractDatabaseRowTitle(database, row)} (${row.id})`);
    rowSnapshots.push(await buildPageSnapshot(client, rowPage, new Set<string>(), logger));
  }

  return {
    databaseTitle,
    rowSnapshots,
  };
};
