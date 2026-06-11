export type NotionConnectorEnv = Readonly<{
  notionApiKey: string;
  notionRootPageId: string;
}>;

const readRequiredEnvVar = (name: string): string => {
  const value = process.env[name];

  if (value === undefined || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
};

export const loadNotionConnectorEnv = (): NotionConnectorEnv => ({
  notionApiKey: readRequiredEnvVar("NOTION_API_KEY"),
  notionRootPageId: readRequiredEnvVar("NOTION_ROOT_PAGE_ID"),
});
