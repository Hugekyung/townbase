import { NestFactory } from "@nestjs/core";
import { bootstrap } from "../src/chat/mcp-entrypoint";
import { mcpStartupFailure } from "../src/chat/mcp-startup-failure";
import { RuntimeProfileError } from "../src/runtime-profile";

describe("MCP startup boundary and safe diagnostics", () => {
  const original = { ...process.env };
  afterEach(() => {
    process.env = { ...original };
    jest.restoreAllMocks();
  });
  it.each([undefined, "self_hosted", "unknown"])(
    "refuses before Nest/DB initialization with profile %p",
    async (profile) => {
      if (profile == null) delete process.env.TOWNBASE_RUNTIME_PROFILE;
      else process.env.TOWNBASE_RUNTIME_PROFILE = profile;
      const initialize = jest
        .spyOn(NestFactory, "createApplicationContext")
        .mockRejectedValue(new Error("unexpected_nest_initialization"));
      await expect(bootstrap()).rejects.toBeInstanceOf(RuntimeProfileError);
      expect(initialize).not.toHaveBeenCalled();
    },
  );
  it("reports a configuration/startup failure without its raw message", async () => {
    process.env.NODE_ENV = "test";
    process.env.TOWNBASE_RUNTIME_PROFILE = "legacy_development";
    const error = new Error("postgresql://secret-canary@private");
    jest
      .spyOn(NestFactory, "createApplicationContext")
      .mockRejectedValue(error);
    await expect(bootstrap()).rejects.toBe(error);
    expect(mcpStartupFailure("application", error)).toBe(
      "MCP startup failed [application]. Check development configuration.",
    );
  });
  it("keeps transport failures distinct and does not expose arbitrary errors", () => {
    expect(mcpStartupFailure("transport", { code: "secret-canary" })).toBe(
      "MCP startup failed [transport]. Check development configuration.",
    );
    expect(
      mcpStartupFailure(
        "runtime-profile",
        new RuntimeProfileError("legacy_in_self_hosted", "secret-canary"),
      ),
    ).toBe(
      "MCP startup failed [runtime-profile:legacy_in_self_hosted]. Check runtime profile.",
    );
  });
});
