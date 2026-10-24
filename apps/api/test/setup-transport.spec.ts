import {
  setupTransportAllowed,
  type SetupRequest,
} from "../src/setup/setup-transport";

const local = (): SetupRequest => ({
  headers: {
    host: "127.0.0.1:43140",
    origin: "http://127.0.0.1:43140",
    "x-townbase-setup": "1",
  },
  socket: { remoteAddress: "172.18.0.1" },
});
describe("bootstrap transport boundary", () => {
  it("requires the explicit local exception and an exact same-origin request", () => {
    expect(setupTransportAllowed(local(), {})).toBe(false);
    expect(
      setupTransportAllowed(local(), { TOWNBASE_SETUP_LOCAL_HTTP: "1" }),
    ).toBe(true);
  });
  it.each([
    "https://evil.example",
    "null",
    "http://127.0.0.1:43140/path",
    "http://127.0.0.1:43141",
  ])("rejects foreign or malformed origin %s", (origin) => {
    const req = local();
    req.headers.origin = origin;
    expect(setupTransportAllowed(req, { TOWNBASE_SETUP_LOCAL_HTTP: "1" })).toBe(
      false,
    );
  });
  it("rejects absent custom headers and forwarded local HTTP", () => {
    const req = local();
    delete req.headers["x-townbase-setup"];
    expect(setupTransportAllowed(req, { TOWNBASE_SETUP_LOCAL_HTTP: "1" })).toBe(
      false,
    );
    req.headers["x-townbase-setup"] = "1";
    req.headers["x-forwarded-proto"] = "https";
    expect(setupTransportAllowed(req, { TOWNBASE_SETUP_LOCAL_HTTP: "1" })).toBe(
      false,
    );
  });
  it("requires the approved HTTPS origin and exact trusted proxy peer", () => {
    const env = {
      TOWNBASE_PUBLIC_ORIGIN: "https://townbase.example.org",
      TOWNBASE_TRUSTED_PROXY_IP: "172.18.0.1",
      TOWNBASE_SETUP_LOCAL_HTTP: "1",
    };
    const req = local();
    req.headers.host = "townbase.example.org";
    req.headers.origin = "https://townbase.example.org";
    req.headers["x-forwarded-proto"] = "https";
    expect(setupTransportAllowed(req, env)).toBe(true);
    req.socket.remoteAddress = "172.18.0.2";
    expect(setupTransportAllowed(req, env)).toBe(false);
    req.socket.remoteAddress = "::ffff:172.18.0.1";
    expect(setupTransportAllowed(req, env)).toBe(true);
    expect(
      setupTransportAllowed(req, {
        ...env,
        TOWNBASE_TRUSTED_PROXY_IP: "::FFFF:172.18.0.1",
      }),
    ).toBe(true);
    req.headers["x-forwarded-proto"] = "http";
    expect(setupTransportAllowed(req, env)).toBe(false);
    expect(setupTransportAllowed(local(), env)).toBe(false);
  });
});
