import { ChatMcpServer } from "../src/chat/chat.server";
import { CliConnectorSyncRunner } from "../src/ingestion/connector-runner";
import type { ChatToolRegistry } from "../src/chat/chat.registry";
describe("legacy side-effect gates", () => {
  const original = { ...process.env };
  afterEach(() => {
    process.env = { ...original };
  });
  it.each(["self_hosted", "unknown"])(
    "refuses MCP construction/transport and connector subprocesses: %s",
    async (profile) => {
      process.env.TOWNBASE_RUNTIME_PROFILE = profile;
      const registry = { listTools: jest.fn(), callTool: jest.fn() };
      const server = new ChatMcpServer(registry as unknown as ChatToolRegistry);
      expect(() => server.buildServer()).toThrow(/profile/);
      await expect(server.startStdio()).rejects.toThrow(/profile/);
      expect(registry.listTools).not.toHaveBeenCalled();
      expect(registry.callTool).not.toHaveBeenCalled();
      const execute = jest.fn();
      const runner = new CliConnectorSyncRunner(execute);
      await expect(runner.runNotionSync()).rejects.toThrow(/profile/);
      await expect(
        runner.runRepoSync({ repoNames: ["example"] }),
      ).rejects.toThrow(/profile/);
      expect(execute).not.toHaveBeenCalled();
    },
  );
});
