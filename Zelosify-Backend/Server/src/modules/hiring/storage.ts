import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { MAX_FILE_SIZE, fail } from "./domain.js";
export type DocumentScope = {
  documentKey: string;
  tenantId: string;
  uploadedBy: string;
};
export interface ProfileStorage {
  put(
    tx: Prisma.TransactionClient,
    scope: DocumentScope,
    body: Buffer,
  ): Promise<void>;
  get(scope: DocumentScope, signal?: AbortSignal): Promise<Buffer>;
}
export class PostgresProfileStorage implements ProfileStorage {
  constructor(private db: PrismaClient) {}
  async put(tx: Prisma.TransactionClient, scope: DocumentScope, body: Buffer) {
    const upload = await tx.profileUpload.findFirst({
      where: {
        documentKey: scope.documentKey,
        uploadedBy: scope.uploadedBy,
        opening: { tenantId: scope.tenantId },
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { size: true },
    });
    if (!upload)
      return fail(404, "NOT_FOUND", "Upload reservation not found or expired");
    if (
      !Buffer.isBuffer(body) ||
      body.length !== upload.size ||
      body.length < 1 ||
      body.length > MAX_FILE_SIZE
    ) {
      return fail(
        422,
        "INVALID_FILE",
        "Document size does not match the reservation",
      );
    }
    const sha256 = createHash("sha256").update(body).digest("hex");
    await tx.profileDocument.createMany({
      data: [
        { documentKey: scope.documentKey, bytes: new Uint8Array(body), sha256 },
      ],
      skipDuplicates: true,
    });
    const stored = await tx.profileDocument.findUniqueOrThrow({
      where: { documentKey: scope.documentKey },
      select: { sha256: true },
    });
    if (stored.sha256 !== sha256)
      return fail(
        409,
        "UPLOAD_CONFLICT",
        "Upload reservation already contains another file",
      );
  }
  async get(scope: DocumentScope, signal = AbortSignal.timeout(1500)) {
    signal.throwIfAborted();
    const document = await this.db.profileDocument.findFirst({
      where: {
        documentKey: scope.documentKey,
        upload: {
          uploadedBy: scope.uploadedBy,
          opening: { tenantId: scope.tenantId },
        },
      },
      select: { bytes: true, sha256: true },
    });
    signal.throwIfAborted();
    if (!document)
      return fail(404, "DOCUMENT_NOT_FOUND", "Profile document not found");
    const bytes = Buffer.from(document.bytes);
    if (
      bytes.length < 1 ||
      bytes.length > MAX_FILE_SIZE ||
      createHash("sha256").update(bytes).digest("hex") !== document.sha256
    ) {
      return fail(
        422,
        "INVALID_FILE",
        "Stored document failed integrity validation",
      );
    }
    return bytes;
  }
}
