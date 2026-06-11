import { loadNotionConnectorEnv } from "./env";

export const runNotionSync = async (): Promise<void> => {
  loadNotionConnectorEnv();
};

const main = async (): Promise<void> => {
  await runNotionSync();
};

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
