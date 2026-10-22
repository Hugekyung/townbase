import { readFileSync } from "node:fs";

export function databaseEnvironment(env = process.env) {
  if (!env.POSTGRES_PASSWORD_FILE)
    throw new Error("Database secret file is required");
  const password = readFileSync(env.POSTGRES_PASSWORD_FILE, "utf8").trim();
  if (password.length < 32) throw new Error("Database secret is invalid");
  const url = new URL("postgresql://postgres:5432/townbase");
  url.hostname = env.POSTGRES_HOST ?? "postgres";
  url.username = env.POSTGRES_USER ?? "townbase";
  url.password = password;
  url.pathname = `/${env.POSTGRES_DB ?? "townbase"}`;
  url.search =
    "schema=public&connect_timeout=3&pool_timeout=3&socket_timeout=3";
  return url.toString();
}
