import { CliConnectorSyncRunner } from "../src/ingestion/connector-runner";

type ExecCall = Readonly<{
  file: string;
  args: readonly string[];
}>;

const repoSummaryStdout = [
  "pnpm 10.33.2",
  "",
  "{",
  '  "inserted": 1,',
  '  "updated": 2,',
  '  "archived": 3,',
  '  "skippedUnchanged": 4,',
  '  "failed": 0,',
  '  "failures": []',
  "}",
].join("\n");

describe("CliConnectorSyncRunner", () => {
  it("runs local-repo sync with explicit repo args and parses the summary after pnpm banners", async () => {
    const calls: ExecCall[] = [];
    const runner = new CliConnectorSyncRunner(async (file, args) => {
      calls.push({ file, args });
      return {
        stdout: repoSummaryStdout,
        stderr: "",
      };
    });

    const summary = await runner.runRepoSync({ repoNames: ["alpha", "beta"] });

    expect(summary).toEqual({
      inserted: 1,
      updated: 2,
      archived: 3,
      skippedUnchanged: 4,
      failed: 0,
      failures: [],
    });
    expect(calls).toEqual([
      {
        file: "pnpm",
        args: [
          "--filter",
          "@townbase/connectors",
          "run",
          "local-repo:sync",
          "--",
          "--repo",
          "alpha",
          "--repo",
          "beta",
        ],
      },
    ]);
  });
});
