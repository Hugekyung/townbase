import { startupFailure } from "../src/startup-failure";

describe("safe startup diagnostics", () => {
  it("reports the stage and known OS error without disclosing messages or paths", () => {
    const error = Object.assign(new Error("postgres://secret-canary@private"), {
      code: "EADDRINUSE",
      path: "/private/secret-canary",
    });
    expect(startupFailure("listen", error)).toBe(
      "Townbase startup failed [listen:EADDRINUSE]. Check deployment configuration.",
    );
  });
  it.each([null, undefined, "secret-canary", { code: "secret-canary" }])(
    "never logs arbitrary thrown values or error codes: %p",
    (error) => {
      expect(startupFailure("runtime-profile", error)).toBe(
        "Townbase startup failed [runtime-profile]. Check deployment configuration.",
      );
    },
  );
});
