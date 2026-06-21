import type { NotionClientLike } from "../src/notion";

export const createUnsupportedRootClient = (): NotionClientLike => ({
  pages: {
    retrieve: async () => {
      throw {
        status: 404,
        code: "object_not_found",
        message: "Missing page: unknown-root",
      };
    },
  },
  blocks: {
    children: {
      list: async () => {
        throw new Error("Not expected");
      },
    },
  },
  databases: {
    retrieve: async () => {
      throw {
        status: 404,
        code: "object_not_found",
        message: "Missing database: unknown-root",
      };
    },
    query: async () => {
      throw {
        status: 404,
        code: "object_not_found",
        message: "Missing database: unknown-root",
      };
    },
  },
});
