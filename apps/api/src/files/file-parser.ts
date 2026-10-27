import mammoth from "mammoth";
import path from "node:path";
import { fromBuffer, type ZipFile, type Entry } from "yauzl";
import { parseMarkdownSectionsWithLocations } from "@townbase/rag-core";
import {
  FILE_LIMITS,
  boundedCodePoints,
  FileError,
  type FileFormat,
  type FileExtraction,
  type FileSegment,
} from "./file-contract";

// Called only in the bounded child. No file paths/URLs are accepted by any parser.
export async function parseFile(
  bytes: Buffer,
  format: FileFormat,
): Promise<FileExtraction> {
  if (bytes.length === 0) throw new FileError("no_extractable_text");
  if (bytes.length > FILE_LIMITS.bytes) throw new FileError("file_too_large");
  let count = 0;
  const segments: FileSegment[] = [];
  const append = (
    text: string,
    location: FileSegment["location"],
    headingPath: string[] = [],
  ) => {
    if (!text.trim()) return;
    count += boundedCodePoints(text);
    if (count > FILE_LIMITS.codePoints) throw new FileError("extraction_limit");
    segments.push({ text, location, headingPath: [...headingPath] });
  };
  if (format === "pdf") {
    if (bytes.subarray(0, 5).toString("ascii") !== "%PDF-")
      throw new FileError("invalid_format");
    // Native import must survive the CommonJS compilation of this application.
    const pdf = await (new Function(
      "return import('pdfjs-dist/legacy/build/pdf.mjs')",
    )() as Promise<typeof import("pdfjs-dist/types/src/pdf")>);
    const task = pdf.getDocument({
      data: new Uint8Array(bytes),
      cMapUrl: path.join(
        path.dirname(require.resolve("pdfjs-dist/package.json")),
        "cmaps/",
      ),
      cMapPacked: true,
      standardFontDataUrl: path.join(
        path.dirname(require.resolve("pdfjs-dist/package.json")),
        "standard_fonts/",
      ),
      useWorkerFetch: false,
      useSystemFonts: false,
      disableFontFace: true,
      useWasm: false,
      verbosity: 0,
      stopAtErrors: true,
      disableAutoFetch: true,
      disableStream: true,
      disableRange: true,
    });
    try {
      const document = await task.promise;
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
        const page = await document.getPage(pageNumber);
        // Stream so a single huge page cannot bypass the extraction limit.
        const reader = page.streamTextContent().getReader();
        let text = "",
          pageCount = 0;
        try {
          for (;;) {
            const chunk = await reader.read();
            if (chunk.done) break;
            for (const item of chunk.value.items) {
              if (!("str" in item)) continue;
              const value = item.str + (item.hasEOL ? "\n" : " ");
              pageCount += boundedCodePoints(value);
              if (count + pageCount > FILE_LIMITS.codePoints)
                throw new FileError("extraction_limit");
              text += value;
            }
          }
        } finally {
          await reader.cancel().catch(() => undefined);
        }
        append(text.trimEnd(), { page: pageNumber });
        page.cleanup();
      }
    } catch (error) {
      if (error instanceof FileError) throw error;
      if (
        error != null &&
        typeof error === "object" &&
        "name" in error &&
        error.name === "PasswordException"
      )
        throw new FileError("encrypted_file");
      throw new FileError("invalid_format");
    } finally {
      await task.destroy();
    }
  } else if (format === "docx") {
    await inspectDocx(bytes);
    let headings: string[] = [],
      paragraph = 0;
    type Node = {
      type: string;
      value?: string;
      styleId?: string;
      styleName?: string;
      children?: Node[];
    };
    const textOf = (node: Node): string =>
      node.type === "text"
        ? (node.value ?? "")
        : node.type === "tab"
          ? "\t"
          : node.type === "break"
            ? "\n"
            : (node.children ?? []).map(textOf).join("");
    const visit = (node: Node): void => {
      if (node.type === "paragraph") {
        paragraph++;
        const text = textOf(node);
        const heading =
          /^(?:heading|Heading)\s*([1-6])$/.exec(node.styleId ?? "") ??
          /^(?:heading|Heading)\s*([1-6])$/.exec(node.styleName ?? "");
        if (heading) {
          headings = headings.slice(0, Number(heading[1]) - 1);
          headings.push(text);
        }
        append(text, { paragraph }, headings);
      } else {
        for (const child of node.children ?? []) visit(child);
      }
    };
    try {
      const result = await mammoth.convertToHtml(
        { buffer: bytes },
        {
          externalFileAccess: false,
          includeEmbeddedStyleMap: false,
          transformDocument: (document: Node) => {
            visit(document);
            // Text/locations come from the model. Do not generate/render HTML or load images.
            return { ...document, children: [] };
          },
        },
      );
      if (result.messages.some((message) => message.type === "error"))
        throw new FileError("invalid_format");
    } catch (error) {
      if (error instanceof FileError) throw error;
      throw new FileError("invalid_format");
    }
  } else {
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new FileError("invalid_utf8");
    }
    // Reject binary masquerading as text, including PDF/ZIP renamed .txt/.md.
    if (
      /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text) ||
      text.startsWith("%PDF-") ||
      text.startsWith("PK\x03\x04")
    )
      throw new FileError("invalid_format");
    if (boundedCodePoints(text) > FILE_LIMITS.codePoints)
      throw new FileError("extraction_limit");
    if (format === "md") {
      const sections = parseMarkdownSectionsWithLocations(text);
      for (const section of sections) {
        append(
          section.content,
          { lineStart: section.lineStart, lineEnd: section.lineEnd },
          [...section.headingPath],
        );
      }
      if (sections.length === 0)
        append(text, { lineStart: 1, lineEnd: text.split("\n").length });
    } else append(text, { lineStart: 1, lineEnd: text.split("\n").length });
  }
  if (segments.length === 0) throw new FileError("no_extractable_text");
  return { format, segments, codePoints: count };
}

// Validate every entry and its actual decompressed bytes before Mammoth opens the archive.
async function inspectDocx(bytes: Buffer): Promise<void> {
  const zip = await new Promise<ZipFile>((resolve, reject) =>
    fromBuffer(
      bytes,
      { lazyEntries: true, validateEntrySizes: true, strictFileNames: true },
      (error, value) =>
        error || !value
          ? reject(new FileError("invalid_format"))
          : resolve(value),
    ),
  );
  await new Promise<void>((resolve, reject) => {
    let entries = 0,
      total = 0,
      declared = 0;
    const names = new Set<string>();
    let settled = false;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      zip.close();
      reject(
        error instanceof FileError ? error : new FileError("invalid_format"),
      );
    };
    zip.on("error", fail);
    zip.on("entry", (entry: Entry) => {
      void (async () => {
        const name = entry.fileName;
        if (++entries > FILE_LIMITS.zipEntries)
          throw new FileError("archive_limit");
        if (
          names.has(name) ||
          name.split("/").includes("..") ||
          /[\\\x00-\x1f]/.test(name) ||
          name.startsWith("/") ||
          /^[A-Za-z]:/.test(name) ||
          ((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000
        )
          throw new FileError("unsafe_archive");
        names.add(name);
        if (entry.isEncrypted()) throw new FileError("encrypted_file");
        declared += entry.uncompressedSize;
        if (
          declared > FILE_LIMITS.zipBytes ||
          entry.uncompressedSize >
            Math.max(1, entry.compressedSize) * FILE_LIMITS.zipRatio
        )
          throw new FileError("archive_limit");
        const stream = await new Promise<import("node:stream").Readable>(
          (yes, no) =>
            zip.openReadStream(entry, (error, value) =>
              error || !value ? no(error) : yes(value),
            ),
        );
        let tail = "",
          actual = 0;
        const decoder = new TextDecoder("utf-8", { fatal: true });
        for await (const chunk of stream) {
          const part = chunk as Buffer;
          total += part.length;
          actual += part.length;
          if (
            total > FILE_LIMITS.zipBytes ||
            actual > Math.max(1, entry.compressedSize) * FILE_LIMITS.zipRatio
          ) {
            stream.destroy();
            throw new FileError("archive_limit");
          }
          if (name.endsWith(".xml") || name.endsWith(".rels")) {
            const decoded = decoder.decode(part, { stream: true });
            if (decoded.includes("\0")) {
              stream.destroy();
              throw new FileError("invalid_format");
            }
            const scan = tail + decoded;
            if (/<!DOCTYPE|<!ENTITY/i.test(scan)) {
              stream.destroy();
              throw new FileError("unsafe_archive");
            }
            tail = scan.slice(-16);
          }
        }
        if (name.endsWith(".xml") || name.endsWith(".rels")) decoder.decode();
        zip.readEntry();
      })().catch(fail);
    });
    zip.on("end", () => {
      if (settled) return;
      settled = true;
      if (!names.has("word/document.xml") || !names.has("[Content_Types].xml"))
        reject(new FileError("invalid_format"));
      else resolve();
      zip.close();
    });
    zip.readEntry();
  });
}
