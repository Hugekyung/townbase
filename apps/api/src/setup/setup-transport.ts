import { isIP } from "node:net";

export type SetupRequest = {
  headers: Record<string, string | string[] | undefined>;
  socket: { remoteAddress?: string | undefined; encrypted?: boolean };
};

export function setupTransportAllowed(
  request: SetupRequest,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (request.headers["x-townbase-setup"] !== "1") return false;
  const origin = request.headers.origin,
    host = request.headers.host;
  if (typeof origin !== "string" || typeof host !== "string") return false;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (origin !== url.origin || url.host !== host.toLowerCase()) return false;
  if (env.TOWNBASE_PUBLIC_ORIGIN) {
    let approved: URL;
    try {
      approved = new URL(env.TOWNBASE_PUBLIC_ORIGIN);
    } catch {
      return false;
    }
    if (
      approved.protocol !== "https:" ||
      approved.origin !== env.TOWNBASE_PUBLIC_ORIGIN ||
      origin !== approved.origin
    )
      return false;
    if (request.socket.encrypted === true) return true;
    const peer = request.socket.remoteAddress
      ?.replace(/^::ffff:/, "")
      .toLowerCase();
    const trusted = env.TOWNBASE_TRUSTED_PROXY_IP?.toLowerCase();
    return (
      trusted != null &&
      isIP(trusted) !== 0 &&
      peer === trusted &&
      request.headers["x-forwarded-proto"] === "https"
    );
  }
  return (
    env.TOWNBASE_SETUP_LOCAL_HTTP === "1" &&
    url.protocol === "http:" &&
    ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) &&
    request.headers["x-forwarded-proto"] == null &&
    request.headers["x-forwarded-for"] == null &&
    request.headers["x-forwarded-host"] == null
  );
}
