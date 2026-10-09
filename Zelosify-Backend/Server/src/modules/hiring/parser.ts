import { Worker } from "node:worker_threads";
import { fail } from "./domain.js";
export function parseDocument(
  bytes: Buffer,
  contentType: string,
  signal: AbortSignal,
): Promise<string> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL("../../../workers/resume.cjs", import.meta.url),
      {
        workerData: { bytes, contentType },
        resourceLimits: { maxOldGenerationSizeMb: 128 },
        stdout: true,
        stderr: true,
      },
    );
    let settled = false;
    const finish = (error?: Error, text?: string) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abort);
      void worker.terminate();
      if (error) reject(error);
      else resolve(text!);
    };
    const abort = () => finish(new Error("PROCESSING_DEADLINE"));
    signal.addEventListener("abort", abort, { once: true });
    worker.on("message", (result) => {
      if (result.error || typeof result.text !== "string")
        finish(new Error("DOCUMENT_PARSE_FAILED"));
      else finish(undefined, result.text);
    });
    worker.on("error", () => finish(new Error("DOCUMENT_PARSE_FAILED")));
    worker.on("exit", () => {
      if (!settled) finish(new Error("DOCUMENT_PARSE_FAILED"));
    });
    if (signal.aborted) abort();
  });
}
export function verifyFile(bytes: Buffer, contentType: string) {
  const valid =
    contentType === "application/pdf"
      ? bytes.subarray(0, 5).toString() === "%PDF-"
      : bytes.length > 4 && bytes.readUInt32LE(0) === 0x04034b50;
  if (!valid)
    fail(
      422,
      "INVALID_FILE",
      "File content does not match its declared format",
    );
}
