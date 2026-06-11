export type NotionRichText = Readonly<{
  plain_text: string;
}>;

export type NotionPageRecord = Readonly<{
  id: string;
  url: string;
  created_time: string;
  last_edited_time: string;
  properties: Readonly<{
    title: ReadonlyArray<NotionRichText>;
  }>;
}>;

export type NotionBlockRecord = Readonly<{
  id: string;
  type: string;
  has_children?: boolean;
  [key: string]: unknown;
}>;

export type NotionBlockChildrenResponse = Readonly<{
  results: ReadonlyArray<NotionBlockRecord>;
  next_cursor: string | null;
  has_more: boolean;
}>;

export type NotionClientLike = Readonly<{
  pages: Readonly<{
    retrieve: (input: { page_id: string }) => Promise<NotionPageRecord>;
  }>;
  blocks: Readonly<{
    children: Readonly<{
      list: (input: {
        block_id: string;
        start_cursor?: string;
      }) => Promise<NotionBlockChildrenResponse>;
    }>;
  }>;
}>;

export type NotionPageSnapshot = Readonly<{
  page: Readonly<{
    id: string;
    title: string;
    url: string;
    createdTime?: string;
    lastEditedTime: string;
  }>;
  content: string;
  childPages: ReadonlyArray<NotionPageSnapshot>;
  unsupportedBlockIds: ReadonlyArray<string>;
}>;
