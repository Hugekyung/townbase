import {
  createPrismaClient,
  disconnectPrismaClient,
} from "../src/prisma-client";
import { resolveDefaultWorkspaceName } from "../src/runtime";

async function main(): Promise<void> {
  const prisma = createPrismaClient();
  const workspaceName = resolveDefaultWorkspaceName();

  try {
    await prisma.workspace.upsert({
      where: {
        name: workspaceName,
      },
      create: {
        name: workspaceName,
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
