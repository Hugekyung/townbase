import { runNotionSync } from "../src/sync";
import { runLocalRepoSync } from "../src/local-repo/entrypoint";
import * as env from "../src/env";
describe("connector operating profile gate", () => {
  const original = { ...process.env };
  afterEach(() => {
    process.env = { ...original };
    jest.restoreAllMocks();
  });
  it.each([undefined, "self_hosted", "unknown"])(
    "refuses both connectors before source or database setup: %s",
    async (profile) => {
      if (profile == null) delete process.env.TOWNBASE_RUNTIME_PROFILE;
      else process.env.TOWNBASE_RUNTIME_PROFILE = profile;
      const load = jest.spyOn(env, "loadNotionConnectorEnv");
      const create = jest.fn(() => {
        throw new Error("database must not be constructed");
      });
      await expect(runNotionSync()).rejects.toThrow(/profile/);
      await expect(
        runLocalRepoSync({
          databaseRuntime: { createPrismaClient: create } as never,
        }),
      ).rejects.toThrow(/profile/);
      expect(load).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
    },
  );
});
