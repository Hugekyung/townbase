import type { NotionBlockRecord, NotionRichText } from "./types";

const isRichTextArray = (
  value: unknown,
): value is ReadonlyArray<NotionRichText> =>
  Array.isArray(value) &&
  value.every((item) => typeof item === "object" && item !== null && "plain_text" in item);

const readRichText = (value: unknown): string => {
  if (!isRichTextArray(value)) {
    return "";
  }

  return value.map((segment) => segment.plain_text).join("");
};

const readBlockBody = (block: NotionBlockRecord): string => {
  const payload = block[block.type];

  if (typeof payload !== "object" || payload === null || !("rich_text" in payload)) {
    return "";
  }

  return readRichText((payload as { rich_text?: unknown }).rich_text);
};

export const renderSupportedBlock = (block: NotionBlockRecord): string | null => {
  switch (block.type) {
    case "paragraph":
    case "heading_1":
    case "heading_2":
    case "heading_3":
    case "bulleted_list_item":
    case "numbered_list_item":
    case "code":
      return readBlockBody(block);
    default:
      return null;
  }
};
