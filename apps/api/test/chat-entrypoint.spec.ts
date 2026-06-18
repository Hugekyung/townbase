jest.mock("@nestjs/core", () => {
  const createApplicationContext = jest.fn().mockResolvedValue({
    get: jest.fn().mockReturnValue({
      startStdio: jest.fn().mockResolvedValue(undefined),
    }),
  });

  return {
    NestFactory: {
      createApplicationContext,
    },
  };
});

import { NestFactory } from "@nestjs/core";
import { bootstrap } from "../src/chat/mcp-entrypoint";

describe("chat MCP entrypoint", () => {
  it("disables the Nest logger before starting the stdio transport", async () => {
    await bootstrap();

    expect(NestFactory.createApplicationContext).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        logger: false,
      }),
    );
  });
});
