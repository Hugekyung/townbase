import { BadRequestException, Body, Controller, Post } from "@nestjs/common";

import { IngestionService } from "./ingestion.service";
import type { SyncResponse } from "./ingestion.types";

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readRepoNames = (body: unknown): readonly string[] => {
  if (!isRecord(body)) {
    throw new BadRequestException("repoNames must contain at least one repo name");
  }

  const repoNames = body["repoNames"];

  if (!Array.isArray(repoNames)) {
    throw new BadRequestException("repoNames must contain at least one repo name");
  }

  const normalized = repoNames.map((repoName) => {
    if (typeof repoName !== "string") {
      throw new BadRequestException(
        "repoNames must contain at least one repo name",
      );
    }

    return repoName.trim();
  });
  const selected = Array.from(
    new Set(normalized.filter((repoName) => repoName.length > 0)),
  );

  if (selected.length === 0) {
    throw new BadRequestException("repoNames must contain at least one repo name");
  }

  return selected;
};

@Controller("admin/sync")
export class IngestionController {
  public constructor(private readonly ingestionService: IngestionService) {}

  @Post("repos")
  public syncRepos(@Body() body: unknown): Promise<SyncResponse> {
    return this.ingestionService.syncRepos(readRepoNames(body));
  }

  @Post("notion")
  public syncNotion(@Body() _body: unknown): Promise<SyncResponse> {
    return this.ingestionService.syncNotion();
  }
}
