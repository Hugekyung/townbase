import {
  setupTransportAllowed,
  type SetupRequest,
} from "../setup/setup-transport";
import { SESSION_COOKIE, SESSION_ABSOLUTE_MS } from "./auth-policy";
export type AuthRequest = SetupRequest;
export function authTransportAllowed(
  request: AuthRequest,
  readOnly = false,
): boolean {
  const headers: AuthRequest["headers"] = {
    ...request.headers,
    "x-townbase-setup": request.headers["x-townbase-auth"],
  };
  if (readOnly && headers.origin == null && typeof headers.host === "string")
    headers.origin =
      process.env.TOWNBASE_PUBLIC_ORIGIN || `http://${headers.host}`;
  return setupTransportAllowed({ ...request, headers });
}
export function readSessionCookie(request: AuthRequest): string | undefined {
  const raw = request.headers.cookie;
  if (typeof raw !== "string") return undefined;
  const matches = raw
    .split(";")
    .map((x) => x.trim())
    .filter((x) => x.split("=", 1)[0] === SESSION_COOKIE);
  if (matches.length !== 1) return undefined;
  const value = matches[0]!.slice(SESSION_COOKIE.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : undefined;
}
export function sessionCookie(token: string | undefined): string {
  const secure = process.env.TOWNBASE_PUBLIC_ORIGIN ? "; Secure" : "";
  return `${SESSION_COOKIE}=${token ?? ""}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${token ? Math.floor(SESSION_ABSOLUTE_MS / 1000) : 0}${secure}`;
}

export function isJsonRequest(request: AuthRequest): boolean {
  return (
    typeof request.headers["content-type"] === "string" &&
    /^application\/json(?:\s*;|$)/i.test(request.headers["content-type"])
  );
}
