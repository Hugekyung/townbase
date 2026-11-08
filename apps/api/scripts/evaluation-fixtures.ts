import { zip } from "../test/file-fixtures";
import { readFile } from "node:fs/promises";
import path from "node:path";
// A ToUnicode map makes Korean extraction deterministic without downloading fonts.
export function unicodePdf(text: string): Buffer {
  const chars = [...new Set([...text.replace(/\n/g, "")])],
    codes = new Map(chars.map((c, i) => [c, i + 1]));
  const unicode = (s: string) =>
    Buffer.from(s, "utf16le").swap16().toString("hex").toUpperCase();
  const cmap =
    "/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def /CMapName /Townbase def /CMapType 2 def 1 begincodespacerange <0000> <FFFF> endcodespacerange\n" +
    chars
      .map(
        (c, i) =>
          "1 beginbfchar <" +
          (i + 1).toString(16).padStart(4, "0") +
          "> <" +
          unicode(c) +
          "> endbfchar",
      )
      .join("\n") +
    "\nendcmap CMapName currentdict /CMap defineresource pop end end";
  const content =
    "BT /F1 10 Tf 40 800 Td 14 TL\n" +
    text
      .split("\n")
      .map(
        (line) =>
          "<" +
          [...line]
            .map((c) => codes.get(c)!.toString(16).padStart(4, "0"))
            .join("") +
          "> Tj T*",
      )
      .join("\n") +
    "\nET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 7 0 R >>",
    "<< /Type /Font /Subtype /Type0 /BaseFont /Townbase /Encoding /Identity-H /DescendantFonts [5 0 R] /ToUnicode 6 0 R >>",
    "<< /Type /Font /Subtype /CIDFontType2 /BaseFont /Townbase /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /DW 1000 >>",
    `<< /Length ${Buffer.byteLength(cmap)} >>\nstream\n${cmap}\nendstream`,
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  ];
  let body = "%PDF-1.7\n",
    offsets = [0];
  for (const [i, o] of objects.entries()) {
    offsets.push(Buffer.byteLength(body));
    body += i + 1 + " 0 obj\n" + o + "\nendobj\n";
  }
  const start = Buffer.byteLength(body);
  body +=
    "xref\n0 " +
    (objects.length + 1) +
    "\n0000000000 65535 f \n" +
    offsets
      .slice(1)
      .map((o) => o.toString().padStart(10, "0") + " 00000 n \n")
      .join("") +
    "trailer << /Size " +
    (objects.length + 1) +
    " /Root 1 0 R >>\nstartxref\n" +
    start +
    "\n%%EOF";
  return Buffer.from(body);
}
export function unicodeDocx(text: string): Buffer {
  const escape = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return zip([
    {
      name: "[Content_Types].xml",
      text: '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    },
    {
      name: "_rels/.rels",
      text: '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    },
    {
      name: "word/document.xml",
      text:
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
        text
          .split("\n")
          .filter((s) => s.trim())
          .map(
            (line) =>
              "<w:p>" +
              (line.startsWith("#")
                ? '<w:pPr><w:pStyle w:val="' +
                  (line.startsWith("###") ? "Heading2" : "Heading1") +
                  '"/></w:pPr>'
                : "") +
              '<w:r><w:t xml:space="preserve">' +
              escape(line.replace(/^#+\s*/, "")) +
              "</w:t></w:r></w:p>",
          )
          .join("") +
        "</w:body></w:document>",
    },
  ]);
}
export async function corpusFixtures(root: string, kind: "ops" | "shop") {
  const original = await readFile(path.join(root, kind + "-corpus.md"), "utf8"),
    questionText = await readFile(
      path.join(root, kind + "-questions.md"),
      "utf8",
    );
  const documents = [
    ...original.matchAll(
      /^## ((?:OPS|SHOP)-D\d{2})[^\n]*\n([\s\S]*?)(?=^## |$(?![\s\S]))/gm,
    ),
  ].map((match, i) => {
    const text = match[0]!.trim(),
      format = i < 3 ? "pdf" : i < 6 ? "docx" : i < 9 ? "md" : "txt";
    return {
      id: match[1]!,
      text,
      format,
      name: match[1] + "." + format,
      bytes:
        format === "pdf"
          ? unicodePdf(text)
          : format === "docx"
            ? unicodeDocx(text)
            : Buffer.from(text),
      facts: [...text.matchAll(/^### ([FLC]\d+)\n+([^#]+)/gm)].map((f) => ({
        heading: f[1]!,
        text: f[2]!.trim(),
      })),
    };
  });
  const questions = questionText
    .split("\n")
    .filter((s) => /^\| (?:OPS|SHOP)-Q\d/.test(s))
    .map((line) => {
      const cells = line
        .split("|")
        .slice(1, -1)
        .map((s) => s.trim());
      return {
        id: cells[0]!,
        type: cells[1]!,
        question: cells[2]!,
        expectedFacts: cells[3]!,
        gold: cells[4]!,
        isAnswerable: cells[5] === "true",
      };
    });
  if (documents.length !== 12 || questions.length !== 60)
    throw Error("Evaluation manifest changed");
  return { documents, questions, original, questionText };
}
