import {
  fileChunks,
  CHUNK_BYTES,
  chunkRequestId,
  embeddingVector,
} from "../src/files/file-chunker";
import type { FileExtraction } from "../src/files/file-contract";
function extraction(text: string): FileExtraction {
  return {
    format: "txt",
    codePoints: Array.from(text).length,
    segments: [
      { text, headingPath: [], location: { lineStart: 1, lineEnd: 1 } },
    ],
  };
}
describe("D04 structured file splitting", () => {
  test.each(["한국어😀".repeat(2000), "no-spaces".repeat(3000)])(
    "bounds UTF-8 without losing or splitting Unicode characters",
    (text) => {
      const chunks = fileChunks(extraction(text));
      expect(chunks.length).toBeGreaterThan(1);
      expect(
        chunks.every((c) => Buffer.byteLength(c.content) <= CHUNK_BYTES),
      ).toBe(true);
      expect(chunks.map((c) => c.content).join("")).toBe(
        text.trim().replace(/\s+/gu, " "),
      );
      let end = 0;
      for (const c of chunks) {
        expect(c.parts[0]!.start).toBe(end);
        end = c.parts[0]!.end;
      }
      expect(end).toBe(Array.from(text).length);
    },
  );
  test("preserves PDF pages/headings and bounds metadata for many tiny segments", () => {
    const source: FileExtraction = {
      format: "pdf",
      codePoints: 300,
      segments: Array.from({ length: 300 }, (_, i) => ({
        text: "한",
        location: { page: i + 1 },
        headingPath: ["자료"],
      })),
    };
    const chunks = fileChunks(source);
    expect(chunks).toHaveLength(3);
    expect(chunks.every((c) => c.parts.length <= 128)).toBe(true);
    expect(chunks.flatMap((c) => c.parts).map((p) => p.location.page)).toEqual(
      Array.from({ length: 300 }, (_, i) => i + 1),
    );
    for (const chunk of chunks) {
      expect(chunk.headingPath).toEqual(["자료"]);
      expect(chunk.parts.every((p) => p.headingPath.join() === "자료")).toBe(
        true,
      );
    }
  });
  test("a smaller admitted byte bound preserves the complete text", () => {
    const text = "한국어 ".repeat(300),
      chunks = fileChunks(extraction(text), 256);
    expect(chunks.every((c) => Buffer.byteLength(c.content) <= 256)).toBe(true);
    expect(chunks.map((c) => c.content).join("")).toBe(
      text.trim().replace(/\s+/gu, " "),
    );
  });
  test.each([
    " ".repeat(5000) + "visible",
    "first" + " \t\n".repeat(3000) + "last",
    "😀" + "\n".repeat(5000) + "한" + " ".repeat(5000),
  ])(
    "normalizes whitespace deliberately and retains original code point offsets",
    (text) => {
      const chunks = fileChunks(extraction(text), 256);
      expect(chunks.map((c) => c.content).join("")).toBe(
        text.trim().replace(/\s+/gu, " "),
      );
      expect(
        chunks.every(
          (c) => c.content.trim() && Buffer.byteLength(c.content) <= 256,
        ),
      ).toBe(true);
      const points = Array.from(text);
      expect(chunks[0]!.parts[0]!.start).toBe(
        points.findIndex((c) => /\S/u.test(c)),
      );
      const last = chunks.at(-1)!.parts.at(-1)!;
      expect(last.end).toBe(Array.from(text.trimEnd()).length);
    },
  );
  test("digest and call IDs are stable, distinct per run/chunk, and valid UUIDv4", () => {
    expect(fileChunks(extraction("same"))).toEqual(
      fileChunks(extraction("same")),
    );
    const id = chunkRequestId("one", 0);
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(chunkRequestId("one", 0)).toBe(id);
    expect(chunkRequestId("one", 1)).not.toBe(id);
    expect(chunkRequestId("two", 0)).not.toBe(id);
  });
  test.each([
    undefined,
    [],
    Array(1535).fill(1),
    Array(1536).fill(0),
    Array(1536).fill(NaN),
    Array(1536).fill(Infinity),
    Array(1536).fill(1e100),
    Array(1536).fill(1e-30),
    Object.assign(Array(1536), { 0: 1 }),
  ])("rejects invalid vectors", (v) =>
    expect(() => embeddingVector(v)).toThrow(),
  );
  test("accepts only the fixed nonzero finite vector", () =>
    expect(() => embeddingVector(Array(1536).fill(0.1))).not.toThrow());
});
