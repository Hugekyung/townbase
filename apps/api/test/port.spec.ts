import { parsePort } from "../src/port";

describe("parsePort", () => {
  it("returns the default port when PORT is unset", () => {
    expect(parsePort(undefined)).toBe(3000);
  });

  it("rejects ports outside the valid TCP range", () => {
    expect(() => parsePort("65536")).toThrow("Invalid PORT value: 65536");
  });
});
