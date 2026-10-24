// Child-process fixture only: a broken profile gate must never contact a service.
const deny = () => {
  throw new Error("Forbidden network attempt in profile test");
};
require("node:net").Socket.prototype.connect = deny;
globalThis.fetch = deny;

// Do not read this checkout's private .env, including manual connector loaders.
const fs = require("node:fs");
const { resolve } = require("node:path");
const localEnv = resolve(__dirname, "../../.env");
const isLocalEnv = (path) =>
  typeof path === "string" && resolve(path) === localEnv;
const existsSync = fs.existsSync;
fs.existsSync = (path) => (isLocalEnv(path) ? false : existsSync(path));
const readFileSync = fs.readFileSync;
fs.readFileSync = (path, ...args) => {
  if (isLocalEnv(path))
    throw Object.assign(new Error("Local env excluded from fixture"), {
      code: "ENOENT",
    });
  return readFileSync(path, ...args);
};
