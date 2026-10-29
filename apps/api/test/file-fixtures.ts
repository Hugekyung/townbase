import { deflateRawSync } from "node:zlib";
export function zip(
  entries: Array<{
    name: string;
    text: string;
    encrypted?: boolean;
    deflate?: boolean;
  }>,
): Buffer {
  const parts: Buffer[] = [],
    directory: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name),
      raw = Buffer.from(entry.text),
      compressed = entry.deflate ? deflateRawSync(raw) : raw,
      data = entry.encrypted
        ? Buffer.concat([Buffer.alloc(12), compressed])
        : compressed;
    let crc = 0xffffffff;
    for (const byte of raw) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++)
        crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(entry.encrypted ? 1 : 0, 6);
    header.writeUInt16LE(entry.deflate ? 8 : 0, 8);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(raw.length, 22);
    header.writeUInt16LE(name.length, 26);
    parts.push(header, name, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(entry.encrypted ? 1 : 0, 8);
    central.writeUInt16LE(entry.deflate ? 8 : 0, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    directory.push(central, name);
    offset += header.length + name.length + data.length;
  }
  const central = Buffer.concat(directory),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, central, end]);
}
export function docx(
  extra: Array<{
    name: string;
    text: string;
    encrypted?: boolean;
    deflate?: boolean;
  }> = [],
): Buffer {
  return zip([
    {
      name: "[Content_Types].xml",
      text: '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    },
    {
      name: "_rels/.rels",
      text: '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    },
    {
      name: "word/document.xml",
      text: '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>운영 안내</w:t></w:r></w:p><w:p><w:r><w:t>Townbase 문서 본문</w:t></w:r></w:p></w:body></w:document>',
    },
    ...extra,
  ]);
}
export function pdf(text: string | null = "Townbase source text"): Buffer {
  const content =
    text == null
      ? ""
      : `BT /F1 12 Tf 72 720 Td (${text
          .replace(/[\\()]/g, "\\$&")
          .replace(/\r/g, "\\r")
          .replace(/\n/g, "\\n")}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  ];
  let output = "%PDF-1.7\n",
    offsets = [0];
  objects.forEach((object, i) => {
    offsets.push(Buffer.byteLength(output));
    output += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(output);
  output +=
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets
      .slice(1)
      .map((n) => `${String(n).padStart(10, "0")} 00000 n \n`)
      .join("");
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(output);
}

// Password-required Standard encryption dictionary; text must never be parsed without a key.
export function encryptedPdf(): Buffer {
  const zeros = "00".repeat(32),
    id = "01".repeat(16);
  return Buffer.from(
    pdf()
      .toString("ascii")
      .replace(
        "/Root 1 0 R >>",
        `/Root 1 0 R /Encrypt << /Filter /Standard /V 1 /R 2 /Length 40 /O <${zeros}> /U <${zeros}> /P -4 >> /ID [<${id}><${id}>] >>`,
      ),
  );
}
