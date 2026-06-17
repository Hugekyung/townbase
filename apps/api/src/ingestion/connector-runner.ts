import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type {
  ConnectorSyncFailure,
  ConnectorSyncSummary,
  RunNotionSyncRequest,
  RunRepoSyncRequest,
} from "./ingestion.types";

const execFileAsync = promisify(execFile);

export const CONNECTOR_SYNC_RUNNER = "CONNECTOR_SYNC_RUNNER" as const;

export interface ConnectorSyncRunner {
  runNotionSync(request: RunNotionSyncRequest): Promise<ConnectorSyncSummary>;
  runRepoSync(request: RunRepoSyncRequest): Promise<ConnectorSyncSummary>;
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readNumber = (
  value: Readonly<Record<string, unknown>>,
  key: string,
): number => {
  const rawValue = value[key];

  if (typeof rawValue !== "number") {
    throw new Error(`Connector summary field ${key} must be a number`);
  }

  return rawValue;
};

const readFailures = (
  value: Readonly<Record<string, unknown>>,
): readonly ConnectorSyncFailure[] | undefined => {
  const failures = value["failures"];

  if (failures === undefined) {
    return undefined;
  }

  if (!Array.isArray(failures)) {
    throw new Error("Connector summary failures must be an array");
  }

  return failures.map((failure): ConnectorSyncFailure => {
    if (!isRecord(failure) || typeof failure["reason"] !== "string") {
      throw new Error("Connector summary failure reason must be a string");
    }

    const pageId = failure["pageId"];
    const pageTitle = failure["pageTitle"];

    return {
      ...(typeof pageId === "string" ? { pageId } : {}),
      ...(typeof pageTitle === "string" ? { pageTitle } : {}),
      reason: failure["reason"],
    };
  });
};

const parseConnectorSummary = (stdout: string): ConnectorSyncSummary => {
  const parsed: unknown = JSON.parse(stdout.trim());

  if (!isRecord(parsed)) {
    throw new Error("Connector sync did not return a summary object");
  }

  const failed = parsed["failed"];
  const failures = readFailures(parsed);

  return {
    inserted: readNumber(parsed, "inserted"),
    updated: readNumber(parsed, "updated"),
    archived: readNumber(parsed, "archived"),
    skippedUnchanged: readNumber(parsed, "skippedUnchanged"),
    ...(typeof failed === "number" ? { failed } : {}),
    ...(failures === undefined ? {} : { failures }),
  };
};

export class CliConnectorSyncRunner implements ConnectorSyncRunner {
  public async runNotionSync(
    request: RunNotionSyncRequest,
  ): Promise<ConnectorSyncSummary> {
    const env = {
      ...process.env,
      ...(request.fixturePath === undefined
        ? {}
        : { NOTION_SYNC_FIXTURE_PATH: request.fixturePath }),
    };
    const { stdout } = await execFileAsync(
      "pnpm",
      ["--filter", "@townbase/connectors", "notion:sync"],
      { env },
    );

    return parseConnectorSummary(stdout);
  }

  public async runRepoSync(
    request: RunRepoSyncRequest,
  ): Promise<ConnectorSyncSummary> {
    const repoArgs = request.repoNames.flatMap((repoName) => [
      "--repo",
      repoName,
    ]);
    const { stdout } = await execFileAsync(
      "pnpm",
      ["--filter", "@townbase/connectors", "local-repo:sync", "--", ...repoArgs],
    );

    return parseConnectorSummary(stdout);
  }
}
