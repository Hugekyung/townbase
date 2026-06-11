import {
  createPrismaClient,
  disconnectPrismaClient,
} from "../src/prisma-client";
import { DEFAULT_WORKSPACE_NAME } from "../src/runtime";

async function main(): Promise<void> {
  const prisma = createPrismaClient();

  try {
    await prisma.workspace.upsert({
      where: {
        name: DEFAULT_WORKSPACE_NAME,
      },
      create: {
        name: DEFAULT_WORKSPACE_NAME,
      },
      update: {},
    });
  } finally {
    await disconnectPrismaClient();
  }
}

void main().catch(async (error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
