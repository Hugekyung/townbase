export type BlockRecord = Readonly<{
  id: string;
  type: string;
  has_children?: boolean;
  [key: string]: unknown;
}>;

export type PageRecord = Readonly<{
  id: string;
  url: string;
  created_time: string;
  last_edited_time: string;
  properties: {
    title: Array<{
      plain_text: string;
    }>;
  };
}>;

export type DatabaseRecord = Readonly<{
  id: string;
  title: Array<{
    plain_text: string;
  }>;
  properties: Record<string, { type: string }>;
}>;

export type DatabaseRowRecord = Readonly<{
  id: string;
  url: string;
  created_time: string;
  last_edited_time: string;
  properties: Record<string, unknown>;
}>;
