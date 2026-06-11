import { PrismaClient } from "@prisma/client";

import { DEFAULT_DATABASE_URL } from "./runtime";

let prismaClient: PrismaClient | undefined;

export const createPrismaClient = (): PrismaClient => {
  if (prismaClient === undefined) {
    prismaClient = new PrismaClient({
      datasources: {
        db: {
          url: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
        },
      },
    });
  }

  return prismaClient;
};

export const disconnectPrismaClient = async (): Promise<void> => {
  if (prismaClient !== undefined) {
    await prismaClient.$disconnect();
    prismaClient = undefined;
  }
};
