import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { MAX_FILE_SIZE, fail } from "./domain.js";
export interface ProfileStorage {
  put(
    key: string,
    body: Buffer,
    contentType: string,
    signal?: AbortSignal,
  ): Promise<void>;
  get(key: string, signal?: AbortSignal): Promise<Buffer>;
}
export class S3ProfileStorage implements ProfileStorage {
  private client = new S3Client({
    region: process.env.S3_AWS_REGION ?? "us-east-1",
    ...(process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
      ? {
          credentials: {
            accessKeyId: process.env.S3_ACCESS_KEY_ID,
            secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
          },
        }
      : {}),
  });
  private bucket() {
    return (
      process.env.S3_BUCKET_NAME ||
      fail(503, "STORAGE_UNCONFIGURED", "Profile storage is not configured")
    );
  }
  async put(
    key: string,
    body: Buffer,
    contentType: string,
    signal = AbortSignal.timeout(1500),
  ) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket(),
        Key: key,
        Body: body,
        ContentType: contentType,
        ServerSideEncryption: "AES256",
        IfNoneMatch: "*",
      }),
      { abortSignal: signal },
    );
  }
  async get(key: string, signal = AbortSignal.timeout(1500)) {
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket(), Key: key }),
      { abortSignal: signal },
    );
    if (!result.Body || (result.ContentLength ?? Infinity) > MAX_FILE_SIZE)
      return fail(422, "INVALID_FILE", "Stored profile exceeds limits");
    const chunks: Buffer[] = [];
    let length = 0;
    for await (const chunk of result.Body as AsyncIterable<Uint8Array>) {
      signal.throwIfAborted();
      length += chunk.length;
      if (length > MAX_FILE_SIZE)
        return fail(422, "INVALID_FILE", "Stored profile exceeds limits");
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
}
