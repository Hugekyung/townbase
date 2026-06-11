const DEFAULT_PORT = 3000;

export function parsePort(rawPort: string | undefined): number {
  if (rawPort === undefined || rawPort.trim().length === 0) {
    return DEFAULT_PORT;
  }

  const parsedPort = Number(rawPort);

  if (!Number.isInteger(parsedPort) || parsedPort <= 0 || parsedPort > 65535) {
    throw new Error(`Invalid PORT value: ${rawPort}`);
  }

  return parsedPort;
}
