import { deflateRawSync } from "node:zlib";
import type {
  LlmProvider,
  Message,
  Completion,
  ToolDefinition,
} from "../../src/modules/hiring/agent/provider.js";
export const resumeText =
  "Candidate has 6 years of experience. Skills: React, TypeScript, Node.js. Location: Remote. Education: BSc Computer Science.";
export const requirements = {
  title: "Frontend Engineer",
  experienceMin: 3,
  experienceMax: 8,
  requiredSkills: ["React", "TypeScript"],
  location: "Remote",
};
export const features = {
  experienceYears: 6,
  skills: ["React", "TypeScript", "Node.js"],
  normalizedSkills: [],
  location: "Remote",
  education: ["BSc Computer Science"],
  keywords: [],
};
export function pdfFixture(text = resumeText) {
  const safeText = text.replace(/[()\\]/g, (character) => `\\${character}`);
  const stream = `BT /F1 11 Tf 40 750 Td (${safeText}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let output = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(output));
    output += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const offset = Buffer.byteLength(output);
  output += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((value) => `${String(value).padStart(10, "0")} 00000 n \n`)
    .join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF`;
  return Buffer.from(output);
}
export function pptxFixture(text = resumeText) {
  const name = Buffer.from("ppt/slides/slide1.xml");
  const data = Buffer.from(
    `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:t>${text.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</a:t></p:sld>`,
  );
  const compressed = deflateRawSync(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12);
  end.writeUInt32LE(local.length + name.length + compressed.length, 16);
  return Buffer.concat([local, name, compressed, central, name, end]);
}
export class ScriptedProvider implements LlmProvider {
  async complete(
    messages: Message[],
    _tools: ToolDefinition[],
    signal: AbortSignal,
  ): Promise<Completion> {
    signal.throwIfAborted();
    const calls = messages.filter((message) => message.role === "tool");
    const names = [
      "parse_resume",
      "extract_features",
      "normalize_skills",
      "match_candidate",
      "score_candidate",
    ];
    const name = names[calls.length];
    if (name)
      return {
        tokens: 20,
        message: {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: `call-${calls.length}`,
              type: "function",
              function: {
                name,
                arguments: JSON.stringify(
                  name === "extract_features" ? features : {},
                ),
              },
            },
          ],
        },
      };
    const score = JSON.parse(calls.at(-1)!.content!).finalScore;
    return {
      tokens: 20,
      message: {
        role: "assistant",
        content: JSON.stringify({
          recommended: score >= 0.75,
          score,
          confidence: 0.9,
          reason:
            "Relevant documented skills and experience match the opening.",
        }),
      },
    };
  }
}
