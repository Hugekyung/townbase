// Child-process fixture only: a broken profile gate must never contact a service.
const deny = () => {
  throw new Error("Forbidden network attempt in profile test");
};
require("node:net").Socket.prototype.connect = deny;
globalThis.fetch = deny;
