import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type {
  ConnectorSyncFailure,
  ConnectorSyncSummary,
  RunRepoSyncRequest,
} from "./ingestion.types";

const execFileAsync = promisify(execFile);

export const CONNECTOR_SYNC_RUNNER = "CONNECTOR_SYNC_RUNNER" as const;

export interface ConnectorSyncRunner {
  runNotionSync(): Promise<ConnectorSyncSummary>;
  runRepoSync(request: RunRepoSyncRequest): Promise<ConnectorSyncSummary>;
}

type ExecFileResult = Readonly<{
  stdout: string;
  stderr: string;
}>;

type ExecFileRunner = (
  file: string,
  args: readonly string[],
) => Promise<ExecFileResult>;

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasSummaryShape = (
  value: unknown,
): value is Readonly<Record<string, unknown>> =>
  isRecord(value) &&
  typeof value["inserted"] === "number" &&
  typeof value["updated"] === "number" &&
  typeof value["archived"] === "number" &&
  typeof value["skippedUnchanged"] === "number";

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

const readOptionalString = (
  value: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined => {
  const rawValue = value[key];

  return typeof rawValue === "string" ? rawValue : undefined;
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

    const sourceId =
      readOptionalString(failure, "sourceId") ??
      readOptionalString(failure, "pageId");
    const sourceTitle =
      readOptionalString(failure, "sourceTitle") ??
      readOptionalString(failure, "pageTitle");

    return {
      ...(sourceId === undefined ? {} : { sourceId }),
      ...(sourceTitle === undefined ? {} : { sourceTitle }),
      reason: failure["reason"],
    };
  });
};

const extractBalancedJsonValue = (
  stdout: string,
  startIndex: number,
): string | undefined => {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = startIndex; index < stdout.length; index += 1) {
    const char = stdout[index];

    if (char === undefined) {
      break;
    }

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === "\\") {
        escaped = true;
        continue;
      }

      if (char === '"') {
        inString = false;
      }

      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{" || char === "[") {
      depth += 1;
      continue;
    }

    if (char === "}" || char === "]") {
      depth -= 1;

      if (depth === 0) {
        return stdout.slice(startIndex, index + 1);
      }
    }
  }

  return undefined;
};

const parseSummaryJson = (stdout: string): Readonly<Record<string, unknown>> => {
  for (let index = stdout.length - 1; index >= 0; index -= 1) {
    if (stdout[index] !== "{") {
      continue;
    }

    const candidate = extractBalancedJsonValue(stdout, index);

    if (candidate === undefined) {
      continue;
    }

    try {
      const parsed: unknown = JSON.parse(candidate);

      if (hasSummaryShape(parsed)) {
        return parsed;
      }
    } catch {
      continue;
    }
  }

  throw new Error("Connector sync did not return a JSON summary");
};

const parseConnectorSummary = (stdout: string): ConnectorSyncSummary => {
  const parsed = parseSummaryJson(stdout);

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
  public constructor(
    private readonly execFileRunner: ExecFileRunner = execFileAsync,
  ) {}

  public async runNotionSync(): Promise<ConnectorSyncSummary> {
    const { stdout } = await this.execFileRunner(
      "pnpm",
      ["--filter", "@townbase/connectors", "run", "notion:sync"],
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
    const { stdout } = await this.execFileRunner(
      "pnpm",
      ["--filter", "@townbase/connectors", "run", "local-repo:sync", "--", ...repoArgs],
    );

    return parseConnectorSummary(stdout);
  }
}
