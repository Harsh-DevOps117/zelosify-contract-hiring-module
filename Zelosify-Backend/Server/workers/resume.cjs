const { parentPort, workerData } = require("node:worker_threads");
const { inflateRawSync } = require("node:zlib");
const MAX_EXPANDED = 20 * 1024 * 1024;
function pptxText(buffer) {
  let end = -1;
  for (
    let i = buffer.length - 22;
    i >= Math.max(0, buffer.length - 65557);
    i--
  ) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error("Invalid PPTX archive");
  const count = buffer.readUInt16LE(end + 10);
  if (count > 2000 || buffer.readUInt16LE(end + 4) !== 0)
    throw new Error("Unsupported archive");
  let position = buffer.readUInt32LE(end + 16);
  let expanded = 0;
  const slides = [];
  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(position) !== 0x02014b50)
      throw new Error("Invalid archive directory");
    const flags = buffer.readUInt16LE(position + 8);
    const method = buffer.readUInt16LE(position + 10);
    const compressedSize = buffer.readUInt32LE(position + 20);
    const size = buffer.readUInt32LE(position + 24);
    const nameLength = buffer.readUInt16LE(position + 28);
    const name = buffer
      .subarray(position + 46, position + 46 + nameLength)
      .toString("utf8");
    const offset = buffer.readUInt32LE(position + 42);
    position +=
      46 +
      nameLength +
      buffer.readUInt16LE(position + 30) +
      buffer.readUInt16LE(position + 32);
    expanded += size;
    if (expanded > MAX_EXPANDED || flags & 1 || ![0, 8].includes(method))
      throw new Error("Archive exceeds safe limits");
    if (!/^ppt\/slides\/slide\d+\.xml$/.test(name)) continue;
    if (buffer.readUInt32LE(offset) !== 0x04034b50)
      throw new Error("Invalid archive entry");
    const start =
      offset +
      30 +
      buffer.readUInt16LE(offset + 26) +
      buffer.readUInt16LE(offset + 28);
    if (start + compressedSize > buffer.length)
      throw new Error("Truncated archive");
    const compressed = buffer.subarray(start, start + compressedSize);
    const data =
      method === 8
        ? inflateRawSync(compressed, {
            maxOutputLength: Math.min(MAX_EXPANDED, size + 1),
          })
        : compressed;
    if (data.length !== size) throw new Error("Invalid archive size");
    const xml = data.toString("utf8");
    if (/<!DOCTYPE|<!ENTITY/i.test(xml))
      throw new Error("XML entities are forbidden");
    const text = [...xml.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)]
      .map((match) =>
        match[1].replace(
          /&#(x[0-9a-f]+|\d+);|&(amp|lt|gt|quot|apos);/gi,
          (_, code, entity) => {
            if (code) {
              const value =
                code[0].toLowerCase() === "x"
                  ? parseInt(code.slice(1), 16)
                  : Number(code);
              return value <= 0x10ffff ? String.fromCodePoint(value) : "";
            }
            return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[
              entity.toLowerCase()
            ];
          },
        ),
      )
      .join("\n");
    slides.push({ name, text });
  }
  if (!slides.length) throw new Error("No slides found");
  return slides
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    .map((slide) => slide.text)
    .join("\n");
}
async function run() {
  const buffer = Buffer.from(workerData.bytes);
  let text;
  if (workerData.contentType === "application/pdf") {
    if (buffer.subarray(0, 5).toString() !== "%PDF-")
      throw new Error("Invalid PDF");
    const extract = require("pdf-extraction");
    const result = await extract(
      {
        data: new Uint8Array(buffer),
        isEvalSupported: false,
        disableFontFace: true,
      },
      {
        max: 100,
        version: "v2.0.550",
      },
    );
    text = result.text;
  } else {
    text = pptxText(buffer);
  }
  text = text
    .replace(
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g,
      " ",
    )
    .slice(0, 24000)
    .trim();
  if (!text) throw new Error("No extractable text; scanned files require OCR");
  parentPort.postMessage({ text });
}
run().catch(() => parentPort.postMessage({ error: "DOCUMENT_PARSE_FAILED" }));
