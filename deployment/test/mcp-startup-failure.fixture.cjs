// Child-process fixture only. No real Nest providers, transport, DB or model work.
const { createRequire } = require("node:module");
const { resolve } = require("node:path");
const apiRequire = createRequire(
  resolve(__dirname, "../../apps/api/package.json"),
);
const { NestFactory } = apiRequire("@nestjs/core");
const stage = process.env.TOWNBASE_MCP_FAILURE_FIXTURE;
if (stage !== "application" && stage !== "transport")
  throw new Error("Unknown startup failure fixture");
NestFactory.createApplicationContext = async () => {
  // Deliberately retain a live handle: setting exitCode alone must fail this test.
  setInterval(() => {}, 1000);
  const fail = () => {
    throw new Error("postgresql://secret-canary@private");
  };
  if (stage === "application") fail();
  return { get: () => ({ startStdio: async () => fail() }) };
};
