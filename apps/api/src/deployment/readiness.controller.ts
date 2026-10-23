import { Controller, Get, Header, Res } from "@nestjs/common";
import {
  access,
  constants,
  realpath,
  stat,
  open,
  unlink,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { DeploymentDatabase } from "./deployment-database";

@Controller()
export class ReadinessController {
  constructor(private readonly database: DeploymentDatabase) {}

  @Get("readyz")
  @Header("Cache-Control", "no-store")
  async getReadiness(
    @Res({ passthrough: true }) response: { status(code: number): void },
  ) {
    const result = await this.database.check();
    let storage: "ready" | "unavailable" = "unavailable";
    try {
      const locations = [
        process.env.TOWNBASE_DOCUMENTS_PATH,
        process.env.TOWNBASE_ATTACHMENTS_PATH,
      ];
      if (
        locations.some(
          (location) => location == null || location.length === 0,
        ) ||
        locations[0] === locations[1]
      ) {
        throw new Error("Separate storage paths are required");
      }
      await Promise.all(
        locations.map((location) =>
          access(location!, constants.R_OK | constants.W_OK | constants.X_OK),
        ),
      );
      const resolved = await Promise.all(
        locations.map((location) => realpath(location!)),
      );
      const [documents, attachments] = resolved as [string, string];
      const nested = (parent: string, child: string) => {
        const relative = path.relative(parent, child);
        return (
          relative === "" ||
          (relative !== ".." &&
            !relative.startsWith(`..${path.sep}`) &&
            !path.isAbsolute(relative))
        );
      };
      if (nested(documents, attachments) || nested(attachments, documents))
        throw new Error("Overlapping storage");
      const stats = await Promise.all(
        resolved.map((location) => stat(location)),
      );
      if (stats.some((entry) => !entry.isDirectory()))
        throw new Error("Storage must be directories");
      for (const location of resolved) {
        const filename = path.join(
          location,
          `.townbase-readiness-${randomUUID()}`,
        );
        const file = await open(filename, "wx", 0o600);
        try {
          await file.writeFile("ready");
          await file.sync();
        } finally {
          try {
            await file.close();
          } finally {
            await unlink(filename);
          }
        }
      }
      storage = "ready";
    } catch {
      // Return state only. Filesystem paths, credentials and DB errors stay private.
    }
    const ready =
      result.database === "ready" &&
      result.schema === "ready" &&
      storage === "ready";
    response.status(ready ? 200 : 503);
    return {
      ...result,
      storage,
      setup: "unavailable",
      capabilities: { administratorSetup: false, chat: false },
    };
  }
}
