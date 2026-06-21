import type { NotionPageRecord, NotionRichText } from "./types";

type LiveNotionPageTitleSegment = Readonly<{
  plain_text: string;
}>;

type LiveNotionPage = Readonly<{
  object: string;
  id: string;
  url: string;
  created_time: string;
  last_edited_time: string;
  properties: Readonly<Record<string, unknown>>;
}>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isTitleSegment = (value: unknown): value is LiveNotionPageTitleSegment =>
  isRecord(value) && typeof value.plain_text === "string";

const isTitleProperty = (
  value: unknown,
): value is Readonly<{
  type: "title";
  title: unknown;
}> =>
  isRecord(value) &&
  value.type === "title" &&
  "title" in value;

const normalizeTitleSegments = (
  value: unknown,
): ReadonlyArray<NotionRichText> => {
  if (!Array.isArray(value) || !value.every(isTitleSegment)) {
    return [{ plain_text: "Untitled" }];
  }

  const title = value.map((segment) => segment.plain_text).join("").trim();

  if (title === "") {
    return [{ plain_text: "Untitled" }];
  }

  return value.map((segment) => ({ plain_text: segment.plain_text }));
};

const extractTitleSegments = (page: LiveNotionPage): unknown => {
  const directTitle = page.properties.title;

  if (directTitle !== undefined) {
    return directTitle;
  }

  return Object.values(page.properties).find((property): property is Readonly<{ title: unknown }> =>
    isTitleProperty(property) && Array.isArray(property.title),
  )?.title;
};

export const normalizeLiveNotionPageRecord = (
  page: LiveNotionPage,
): NotionPageRecord => ({
  id: page.id,
  url: page.url,
  created_time: page.created_time,
  last_edited_time: page.last_edited_time,
  properties: {
    title: normalizeTitleSegments(extractTitleSegments(page)),
  },
});
