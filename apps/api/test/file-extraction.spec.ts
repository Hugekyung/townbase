import { createRequire } from "node:module";
import { FileExtractor as ExtractorType } from "../src/files/file-extractor";
import { FileStorage } from "../src/files/file-storage";
import { FILE_LIMITS, fileFormat } from "../src/files/file-contract";
import {
  mkdtemp,
  rm,
  stat,
  chmod,
  symlink,
  writeFile,
  readdir,
  realpath,
} from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { docx, pdf, zip, encryptedPdf } from "./file-fixtures";
// Exercise the actual production child emitted by the API build, not ts-node in a child.
const { FileExtractor } = createRequire(__filename)(
  "../dist/files/file-extractor",
) as {
  FileExtractor: typeof ExtractorType;
};

describe("D01 bounded real parser process", () => {
  let extractor: ExtractorType;
  beforeEach(() => {
    extractor = new FileExtractor();
  });
  test("UTF-8 text + supplementary characters preserve exact positions/count", async () => {
    const result = await extractor.extract(
      "안내.TXT",
      Buffer.from("첫줄😀\n둘째"),
    );
    expect(result.codePoints).toBe(6);
    expect(result.segments).toEqual([
      {
        text: "첫줄😀\n둘째",
        location: { lineStart: 1, lineEnd: 2 },
        headingPath: [],
      },
    ]);
  });
  test("Markdown reuses heading parser, CRLF and repeated paragraphs retain line positions", async () => {
    const result = await extractor.extract(
      "a.md",
      Buffer.from("# 첫째\r\n본문\r\n## 둘째\r\n본문"),
    );
    expect(result.segments.map((s) => s.headingPath)).toEqual([
      ["첫째"],
      ["첫째", "둘째"],
    ]);
    expect(result.segments.map((s) => s.location.lineStart)).toEqual([2, 4]);
  });
  test("Markdown heading/body text collision preserves body line, including fenced headings", async () => {
    const result = await extractor.extract(
      "a.md",
      Buffer.from("# 정책\n정책\n```\n# 코드 제목\n```\n## 정책\n정책"),
    );
    expect(result.segments.map((segment) => segment.location)).toEqual([
      { lineStart: 2, lineEnd: 5 },
      { lineStart: 7, lineEnd: 7 },
    ]);
    expect(result.segments[0]?.text).toContain("# 코드 제목");
  });
  test("DOCX heading/paragraph text extraction, no HTML output", async () => {
    const result = await extractor.extract("a.docx", docx());
    expect(result.segments[1]).toEqual({
      text: "Townbase 문서 본문",
      headingPath: ["운영 안내"],
      location: { paragraph: 2 },
    });
    expect(result.segments[0]?.text).toBe("운영 안내");
  });
  test("PDF.js real text + page reference", async () => {
    const result = await extractor.extract("a.pdf", pdf());
    expect(result.segments[0]?.text).toContain("Townbase source text");
    expect(result.segments[0]?.location).toEqual({ page: 1 });
  }, 15000);
  test("image-only/empty PDF refuses searchable status", async () => {
    await expect(
      extractor.extract("scan.pdf", pdf(null)),
    ).rejects.toMatchObject({ code: "no_extractable_text" });
  }, 15000);
  test.each([
    "../a.txt",
    "a/b.md",
    ".env",
    ".secret.txt",
    "a.txt\0.pdf",
    "a.exe",
    "a",
  ])("unsafe/unsupported name %s", (name) => {
    expect(() => fileFormat(name)).toThrow();
  });
  test.each([
    ["a.pdf", Buffer.from("not PDF"), "invalid_format"],
    ["a.docx", Buffer.from("not ZIP"), "invalid_format"],
    ["a.txt", Buffer.from([0xc3, 0x28]), "invalid_utf8"],
    ["a.md", Buffer.from("hello\0world"), "invalid_format"],
    ["a.txt", pdf(), "invalid_format"],
    ["a.txt", Buffer.alloc(0), "no_extractable_text"],
  ])("invalid input %s -> %s", async (name, bytes, code) => {
    await expect(
      extractor.extract(name as string, bytes as Buffer),
    ).rejects.toMatchObject({ code });
  });
  test("password-required PDF is reported separately from missing text", async () => {
    await expect(
      extractor.extract("locked.pdf", encryptedPdf()),
    ).rejects.toMatchObject({ code: "encrypted_file" });
  }, 15000);
  test("encrypted ZIP flag is rejected before decompression", async () => {
    const bytes = zip([
      { name: "[Content_Types].xml", text: "content", encrypted: true },
      { name: "word/document.xml", text: "body" },
    ]);
    await expect(extractor.extract("locked.docx", bytes)).rejects.toMatchObject(
      { code: "encrypted_file" },
    );
  });
  test("ZIP traversal and malformed declared byte size are rejected", async () => {
    await expect(
      extractor.extract(
        "a.docx",
        docx([{ name: "../secret.txt", text: "secret" }]),
      ),
    ).rejects.toMatchObject({ code: "invalid_format" });
    const bytes = docx();
    const index = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    bytes.writeUInt32LE(100000000, index + 24);
    await expect(extractor.extract("a.docx", bytes)).rejects.toThrow();
  });
  test("size checked before child creation", async () => {
    await expect(
      extractor.extract("large.txt", Buffer.alloc(FILE_LIMITS.bytes + 1)),
    ).rejects.toMatchObject({ code: "file_too_large" });
  });
  test("maximum-size allowed text is rejected at the extraction limit without a giant character array", async () => {
    await expect(
      extractor.extract("large.txt", Buffer.alloc(FILE_LIMITS.bytes, 0x61)),
    ).rejects.toMatchObject({ code: "extraction_limit" });
  }, 15000);
  test("exact Unicode count at limit succeeds; one more refuses without truncation", async () => {
    expect(
      (
        await extractor.extract(
          "a.txt",
          Buffer.from("😀".repeat(FILE_LIMITS.codePoints)),
        )
      ).codePoints,
    ).toBe(FILE_LIMITS.codePoints);
    await expect(
      extractor.extract(
        "b.txt",
        Buffer.from("😀".repeat(FILE_LIMITS.codePoints + 1)),
      ),
    ).rejects.toMatchObject({ code: "extraction_limit" });
  });
  test("overlapping parser requests are rejected and subsequent call recovers", async () => {
    const first = extractor.extract("a.txt", Buffer.from("hello"));
    await expect(
      extractor.extract("b.txt", Buffer.from("other")),
    ).rejects.toMatchObject({ code: "parser_busy" });
    await first;
    await expect(
      extractor.extract("b.txt", Buffer.from("other")),
    ).resolves.toMatchObject({ format: "txt" });
  });
  test("DOCX ZIP compression bomb is rejected before conversion", async () => {
    await expect(
      extractor.extract(
        "a.docx",
        docx([
          { name: "word/bomb.xml", text: "A".repeat(100000), deflate: true },
        ]),
      ),
    ).rejects.toMatchObject({ code: "archive_limit" });
  });
  test("ZIP entries cap independent of compression", async () => {
    await expect(
      extractor.extract(
        "a.docx",
        docx(
          Array.from({ length: 1000 }, (_, i) => ({
            name: `word/${i}.xml`,
            text: "x",
          })),
        ),
      ),
    ).rejects.toMatchObject({ code: "archive_limit" });
  });
  test("DOCX XML entity declarations rejected", async () => {
    await expect(
      extractor.extract(
        "a.docx",
        docx([
          {
            name: "word/entity.xml",
            text: '<!DOCTYPE x [<!ENTITY x SYSTEM "file:///etc/passwd">]>',
          },
        ]),
      ),
    ).rejects.toMatchObject({ code: "unsafe_archive" });
  });
  test("non-DOCX ZIP and duplicate entries rejected", async () => {
    await expect(
      extractor.extract("a.docx", zip([{ name: "other.txt", text: "hello" }])),
    ).rejects.toMatchObject({ code: "invalid_format" });
    await expect(
      extractor.extract(
        "a.docx",
        docx([{ name: "word/document.xml", text: "duplicate" }]),
      ),
    ).rejects.toMatchObject({ code: "unsafe_archive" });
  });
});

describe("D01 generated-key raw storage", () => {
  let root: string, storage: FileStorage;
  beforeEach(async () => {
    root = await realpath(await mkdtemp(path.join(tmpdir(), "townbase-d01-")));
    storage = new FileStorage(root);
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });
  test("0600 original, byte-for-byte readback, delete", async () => {
    const bytes = Buffer.from("original 😀");
    const key = await storage.write(bytes);
    expect((await stat(path.join(root, key))).mode & 0o777).toBe(0o600);
    expect(await new FileStorage(root).read(key)).toEqual(bytes);
    await storage.remove(key);
    expect(await readdir(root)).toEqual([]);
  });
  test("identical bytes remain separate originals", async () => {
    expect(await storage.write(Buffer.from("same"))).not.toBe(
      await storage.write(Buffer.from("same")),
    );
  });
  test("path traversal + symlink + insecure root rejected", async () => {
    await expect(storage.read("../secret")).rejects.toMatchObject({
      code: "storage_unavailable",
    });
    const key = "11111111-1111-4111-8111-111111111111.bin";
    const target = path.join(root, "private");
    await writeFile(target, "secret", { mode: 0o600 });
    await symlink(target, path.join(root, key));
    await expect(storage.read(key)).rejects.toThrow();
    await chmod(root, 0o755);
    await expect(storage.write(Buffer.from("body"))).rejects.toMatchObject({
      code: "storage_unavailable",
    });
  });
  test("large inode refused before read", async () => {
    const key = await storage.write(Buffer.from("small"));
    await writeFile(path.join(root, key), Buffer.alloc(FILE_LIMITS.bytes + 1));
    await expect(storage.read(key)).rejects.toMatchObject({
      code: "storage_unavailable",
    });
  });
});
