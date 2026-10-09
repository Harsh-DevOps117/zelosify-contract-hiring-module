CREATE TYPE "OpeningStatus" AS ENUM ('OPEN', 'CLOSED', 'ON_HOLD');

CREATE TYPE "ProfileStatus" AS ENUM ('SUBMITTED', 'SHORTLISTED', 'REJECTED');

CREATE TYPE "RecommendationStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

CREATE TABLE "Opening" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "location" TEXT,
    "contractType" TEXT,
    "hiringManagerId" TEXT NOT NULL,
    "experienceMin" INTEGER NOT NULL,
    "experienceMax" INTEGER,
    "requiredSkills" TEXT[],
    "postedDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expectedCompletionDate" TIMESTAMP(3),
    "actionDate" TIMESTAMP(3),
    "status" "OpeningStatus" NOT NULL DEFAULT 'OPEN',

    CONSTRAINT "Opening_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "hiringProfile" (
    "id" SERIAL NOT NULL,
    "openingId" TEXT NOT NULL,
    "s3Key" TEXT NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "ProfileStatus" NOT NULL DEFAULT 'SUBMITTED',
    "shortlistedBy" TEXT,
    "shortlistedAt" TIMESTAMP(3),
    "rejectedBy" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "recommended" BOOLEAN,
    "recommendationScore" DOUBLE PRECISION,
    "recommendationReason" TEXT,
    "recommendationLatencyMs" INTEGER,
    "recommendationVersion" TEXT,
    "recommendationConfidence" DOUBLE PRECISION,
    "recommendedAt" TIMESTAMP(3),
    "recommendationStatus" "RecommendationStatus" NOT NULL DEFAULT 'PENDING',
    "recommendationMetadata" JSONB,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "hiringProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProfileUpload" (
    "id" TEXT NOT NULL,
    "openingId" TEXT NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "s3Key" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "uploadedAt" TIMESTAMP(3),
    "consumedAt" TIMESTAMP(3),

    CONSTRAINT "ProfileUpload_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RecommendationJob" (
    "id" TEXT NOT NULL,
    "profileId" INTEGER NOT NULL,
    "state" "RecommendationStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedUntil" TIMESTAMP(3),
    "leaseToken" TEXT,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecommendationJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Opening_tenantId_postedDate_id_idx" ON "Opening"("tenantId", "postedDate", "id");

CREATE INDEX "Opening_tenantId_hiringManagerId_postedDate_id_idx" ON "Opening"("tenantId", "hiringManagerId", "postedDate", "id");

CREATE UNIQUE INDEX "hiringProfile_s3Key_key" ON "hiringProfile"("s3Key");

CREATE INDEX "hiringProfile_openingId_isDeleted_submittedAt_id_idx" ON "hiringProfile"("openingId", "isDeleted", "submittedAt", "id");

CREATE INDEX "hiringProfile_openingId_uploadedBy_isDeleted_idx" ON "hiringProfile"("openingId", "uploadedBy", "isDeleted");

CREATE INDEX "hiringProfile_recommended_idx" ON "hiringProfile"("recommended");

CREATE UNIQUE INDEX "ProfileUpload_s3Key_key" ON "ProfileUpload"("s3Key");

CREATE INDEX "ProfileUpload_openingId_uploadedBy_expiresAt_idx" ON "ProfileUpload"("openingId", "uploadedBy", "expiresAt");

CREATE UNIQUE INDEX "RecommendationJob_profileId_key" ON "RecommendationJob"("profileId");

CREATE INDEX "RecommendationJob_state_availableAt_lockedUntil_idx" ON "RecommendationJob"("state", "availableAt", "lockedUntil");

ALTER TABLE "Opening" ADD CONSTRAINT "Opening_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenants"("tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "hiringProfile" ADD CONSTRAINT "hiringProfile_openingId_fkey" FOREIGN KEY ("openingId") REFERENCES "Opening"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProfileUpload" ADD CONSTRAINT "ProfileUpload_openingId_fkey" FOREIGN KEY ("openingId") REFERENCES "Opening"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RecommendationJob" ADD CONSTRAINT "RecommendationJob_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "hiringProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "Opening" ADD CONSTRAINT "Opening_experience_range_check" CHECK ("experienceMin" >= 0 AND ("experienceMax" IS NULL OR "experienceMax" >= "experienceMin"));
ALTER TABLE "hiringProfile" ADD CONSTRAINT "hiringProfile_score_check" CHECK ("recommendationScore" IS NULL OR "recommendationScore" BETWEEN 0 AND 1);
ALTER TABLE "hiringProfile" ADD CONSTRAINT "hiringProfile_confidence_check" CHECK ("recommendationConfidence" IS NULL OR "recommendationConfidence" BETWEEN 0 AND 1);
ALTER TABLE "hiringProfile" ADD CONSTRAINT "hiringProfile_size_check" CHECK ("size" > 0 AND "size" <= 10485760);
ALTER TABLE "ProfileUpload" ADD CONSTRAINT "ProfileUpload_size_check" CHECK ("size" > 0 AND "size" <= 10485760);

CREATE UNIQUE INDEX "User_id_tenantId_key" ON "User"("id", "tenantId");
ALTER TABLE "Opening" ADD CONSTRAINT "Opening_hiringManagerId_tenantId_fkey" FOREIGN KEY ("hiringManagerId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT ON UPDATE RESTRICT;
