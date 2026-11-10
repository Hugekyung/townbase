// A shutdown lock must drain admitted writes before owner release. A JS promise
// timeout alone would leave those writes running after releasing ownership.
// If the complete drain/DB disconnect stalls, end the process instead; startup
// recovery handles interrupted work. Never claim an uncertain drain succeeded.
export async function boundedFileShutdown(
  work: () => Promise<void>,
  timeoutMs = 45_000,
): Promise<void> {
  const watchdog = setTimeout(() => {
    process.stderr.write("TOWNBASE_FILE_SHUTDOWN_DEADLINE\n");
    process.exit(1);
  }, timeoutMs);
  try {
    await work();
  } finally {
    clearTimeout(watchdog);
  }
}
