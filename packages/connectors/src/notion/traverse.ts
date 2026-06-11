import { renderSupportedBlock } from "./render";
import type {
  NotionBlockRecord,
  NotionClientLike,
  NotionPageSnapshot,
  NotionPageRecord,
} from "./types";
export type {
  NotionBlockRecord,
  NotionClientLike,
  NotionPageSnapshot,
  NotionPageRecord,
} from "./types";

const extractPageTitle = (page: NotionPageRecord): string =>
  page.properties.title.map((segment) => segment.plain_text).join("");

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
): Promise<{
  contentLines: string[];
  childPages: NotionPageSnapshot[];
  unsupportedBlockIds: string[];
}> => {
  const blocks = await listAllChildBlocks(client, pageId);
  const contentLines: string[] = [];
  const childPages: NotionPageSnapshot[] = [];
  const unsupportedBlockIds: string[] = [];

  for (const block of blocks) {
    if (block.type === "child_page") {
      childPages.push(await loadNotionPageSnapshot(client, block.id));
      continue;
    }

    const rendered = renderSupportedBlock(block);

    if (rendered === null) {
      unsupportedBlockIds.push(block.id);
    } else if (rendered !== "") {
      contentLines.push(rendered);
    }

    if (block.has_children === true) {
      const nested = await collectPageChildren(client, block.id);
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

export const loadNotionPageSnapshot = async (
  client: NotionClientLike,
  pageId: string,
): Promise<NotionPageSnapshot> => {
  const page = await client.pages.retrieve({ page_id: pageId });
  const children = await collectPageChildren(client, pageId);

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
