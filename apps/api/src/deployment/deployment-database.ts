import { Injectable, OnApplicationShutdown } from "@nestjs/common";
import { PrismaClient } from "@townbase/database";
import { readdir } from "node:fs/promises";
import path from "node:path";

@Injectable()
export class DeploymentDatabase implements OnApplicationShutdown {
  readonly prisma = new PrismaClient();

  async check(): Promise<{
    database: "ready" | "unavailable";
    schema: "ready" | "unavailable";
  }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      return { database: "unavailable", schema: "unavailable" };
    }
    try {
      const migrationsPath =
        process.env.TOWNBASE_MIGRATIONS_PATH ??
        path.resolve(
          __dirname,
          "../../../../packages/database/prisma/migrations",
        );
      const entries = await readdir(migrationsPath, { withFileTypes: true });
      const expected = new Set(
        entries
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name),
      );
      const applied = await this.prisma.$queryRaw<
        Array<{
          migration_name: string;
          finished_at: Date | null;
          rolled_back_at: Date | null;
        }>
      >`SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations"`;
      const completed = new Set(
        applied
          .filter((row) => row.finished_at != null)
          .map((row) => row.migration_name),
      );
      const unfinished = applied.some(
        (row) => row.finished_at == null && row.rolled_back_at == null,
      );
      await this.prisma
        .$queryRaw`SELECT (SELECT count(*) FROM "Installation"), (SELECT count(*) FROM "Administrator"), (SELECT count(*) FROM "InstallationAuditEvent"), (SELECT count(*) FROM "BootstrapState" WHERE id = 'primary')`;
      const ready =
        expected.size > 0 &&
        expected.size === completed.size &&
        [...expected].every((name) => completed.has(name)) &&
        !unfinished;
      return { database: "ready", schema: ready ? "ready" : "unavailable" };
    } catch {
      // Schema/filesystem errors and a connection lost mid-probe are distinct.
      try {
        await this.prisma.$queryRaw`SELECT 1`;
        return { database: "ready", schema: "unavailable" };
      } catch {
        return { database: "unavailable", schema: "unavailable" };
      }
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.prisma.$disconnect();
  }
}
