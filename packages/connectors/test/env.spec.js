"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const env_1 = require("../src/env");
describe("loadNotionConnectorEnv", () => {
    it("throws when the Notion env vars are missing", () => {
        const originalApiKey = process.env.NOTION_API_KEY;
        const originalRootPageId = process.env.NOTION_ROOT_PAGE_ID;
        delete process.env.NOTION_API_KEY;
        delete process.env.NOTION_ROOT_PAGE_ID;
        expect(() => (0, env_1.loadNotionConnectorEnv)()).toThrow("Missing required environment variable: NOTION_API_KEY");
        process.env.NOTION_API_KEY = originalApiKey;
        process.env.NOTION_ROOT_PAGE_ID = originalRootPageId;
    });
    it("loads the Notion env vars when they are present", () => {
        process.env.NOTION_API_KEY = "secret-api-key";
        process.env.NOTION_ROOT_PAGE_ID = "root-page-id";
        expect((0, env_1.loadNotionConnectorEnv)()).toEqual({
            notionApiKey: "secret-api-key",
            notionRootPageId: "root-page-id",
        });
    });
});
//# sourceMappingURL=env.spec.js.map