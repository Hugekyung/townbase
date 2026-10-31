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
      const [state] = await this.prisma.$queryRaw<
        Array<{ bootstrap: bigint; authentication: bigint }>
      >`SELECT EXISTS (SELECT 1 FROM "Installation" LIMIT 1) AS installation_probe, EXISTS (SELECT 1 FROM "Administrator" LIMIT 1) AS administrator_probe, EXISTS (SELECT 1 FROM "InstallationAuditEvent" LIMIT 1) AS audit_probe, (SELECT count(*) FROM "BootstrapState" WHERE id = 'primary') AS bootstrap, (SELECT count(*) FROM "AuthenticationState" WHERE id = 'primary') AS authentication, EXISTS (SELECT 1 FROM "AdministratorSession" LIMIT 1) AS session_probe, EXISTS (SELECT 1 FROM "ModelCredential" LIMIT 1) AS credential_probe, EXISTS (SELECT 1 FROM "ModelTransferPolicy" LIMIT 1) AS policy_probe, EXISTS (SELECT 1 FROM "ModelExecutionSettings" LIMIT 1) AS execution_probe, EXISTS (SELECT 1 FROM "ModelCall" LIMIT 1) AS call_probe, EXISTS (SELECT 1 FROM "FileOriginal" LIMIT 1) AS file_original_probe, EXISTS (SELECT 1 FROM "FileVersion" LIMIT 1) AS file_version_probe, EXISTS (SELECT 1 FROM "FileExtractionRun" LIMIT 1) AS file_run_probe, EXISTS (SELECT 1 FROM "FileRun" LIMIT 1) AS file_execution_probe, EXISTS (SELECT 1 FROM "FileRunRequest" LIMIT 1) AS file_request_probe, EXISTS (SELECT 1 FROM "FileIndex" LIMIT 1) AS file_index_probe, EXISTS (SELECT 1 FROM "FileIndexChunk" LIMIT 1) AS file_index_chunk_probe`;
      const ready =
        state?.bootstrap === 1n &&
        state.authentication === 1n &&
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
