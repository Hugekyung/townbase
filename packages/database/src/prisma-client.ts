import { PrismaClient } from "@prisma/client";

import { DEFAULT_DATABASE_URL } from "./runtime";

export const createPrismaClient = (): PrismaClient =>
  new PrismaClient({
    datasources: {
      db: {
        url: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
      },
    },
  });

