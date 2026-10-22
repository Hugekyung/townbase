import { cpSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

// pnpm deploy copies packages but not Prisma's generated sibling .prisma folder.
// Resolve both real dependency trees instead of hard-coding pnpm version paths.
const source = createRequire(
  new URL("../packages/database/package.json", import.meta.url),
);
const application = createRequire(
  path.resolve(process.argv[2], "package.json"),
);
const target = createRequire(application.resolve("@townbase/database"));
const generated = (require) =>
  path.resolve(
    path.dirname(require.resolve("@prisma/client/package.json")),
    "../../.prisma/client",
  );
cpSync(generated(source), generated(target), { recursive: true });
const { PrismaClient } = target("@prisma/client");
const client = new PrismaClient();
await client.$disconnect();
console.log("Production Prisma client artifact is ready.");
