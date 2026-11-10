// Session advisory locks belong to one physical connection, not to a Prisma pool.
// Disable pool recycling only for dedicated lock clients. Loss of the actual
// connection must still fail closed; these settings do not reacquire ownership.
export function fileLockConnectionUrl(
  databaseUrl: string,
  wait = false,
): string {
  const url = new URL(databaseUrl);
  url.searchParams.set("connection_limit", "1");
  url.searchParams.set("max_idle_connection_lifetime", "0");
  url.searchParams.set("max_connection_lifetime", "0");
  // Shutdown drains the same admission lock; a normal 3s socket timeout could
  // abandon admitted writes. boundedFileShutdown bounds the entire shutdown
  // (including stalled sockets) and exits rather than releasing ownership early.
  if (wait) url.searchParams.delete("socket_timeout");
  return url.toString();
}
