ALTER TABLE "hiringProfile" RENAME COLUMN "s3Key" TO "documentKey";
ALTER TABLE "ProfileUpload" RENAME COLUMN "s3Key" TO "documentKey";
ALTER INDEX "hiringProfile_s3Key_key" RENAME TO "hiringProfile_documentKey_key";
ALTER INDEX "ProfileUpload_s3Key_key" RENAME TO "ProfileUpload_documentKey_key";

CREATE TABLE "ProfileDocument" (
    "documentKey" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProfileDocument_pkey" PRIMARY KEY ("documentKey"),
    CONSTRAINT "ProfileDocument_size_check" CHECK (octet_length("bytes") BETWEEN 1 AND 10485760),
    CONSTRAINT "ProfileDocument_sha256_check" CHECK ("sha256" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "ProfileDocument_documentKey_fkey" FOREIGN KEY ("documentKey") REFERENCES "ProfileUpload"("documentKey") ON DELETE CASCADE ON UPDATE CASCADE
);
