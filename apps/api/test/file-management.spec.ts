import { fileInput, isFileUpload } from "../src/files/file-upload";
import { FILE_LIMITS } from "../src/files/file-contract";

describe("D02 strict file request boundary", () => {
  test.each([
    null,
    undefined,
    [],
    {},
    { name: "a.txt" },
    { name: "a.txt", contentBase64: "eA==", installationId: "primary" },
    { name: "a.txt", contentBase64: "eA" },
    { name: "a.txt", contentBase64: "eA=\n" },
    { name: "a.txt", contentBase64: "eB==" },
    { name: "a.txt", contentBase64: "====" },
    { name: "a.txt", contentBase64: "eA-_" },
  ])("rejects invalid body %j", (body) => {
    expect(() => fileInput(body)).toThrow();
  });
  test.each(["../a.txt", "a\\b.md", ".env", "a.exe", "a.txt\u0000"])(
    "rejects unsafe name %s",
    (name) => {
      expect(() => fileInput({ name, contentBase64: "eA==" })).toThrow();
    },
  );
  test("accepts exact byte cap and rejects one byte over despite equal base64 length", () => {
    const bytes = Buffer.alloc(FILE_LIMITS.bytes, 120);
    expect(
      fileInput({ name: "a.txt", contentBase64: bytes.toString("base64") })
        .bytes.length,
    ).toBe(FILE_LIMITS.bytes);
    expect(() =>
      fileInput({
        name: "a.txt",
        contentBase64: Buffer.alloc(FILE_LIMITS.bytes + 1).toString("base64"),
      }),
    ).toThrow();
  });
  test("route-specific large bodies do not widen other endpoints", () => {
    expect(isFileUpload({ method: "POST", url: "/files" })).toBe(true);
    expect(
      isFileUpload({
        method: "PUT",
        url: "/files/11111111-1111-4111-8111-111111111111",
      }),
    ).toBe(true);
    for (const url of [
      "/auth/login",
      "/settings/model-integration",
      "/files/x",
      "/files/../auth/login",
      "/files/reference",
    ])
      expect(isFileUpload({ method: "POST", url })).toBe(false);
  });
});
