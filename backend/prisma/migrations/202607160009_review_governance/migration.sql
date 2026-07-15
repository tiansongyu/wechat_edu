-- Review governance keeps the immutable rating body separate from moderation
-- state and records every administrative state transition with optimistic locks.
CREATE TYPE "ReviewReportCategory" AS ENUM (
  'PRIVACY_LEAK',
  'HARASSMENT',
  'FALSE_INFORMATION',
  'ADVERTISING',
  'OTHER'
);

CREATE TYPE "ReviewReportStatus" AS ENUM (
  'OPEN',
  'ACTION_TAKEN',
  'NO_VIOLATION'
);

ALTER TABLE "reviews"
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "statusChangedReason" VARCHAR(500),
  ADD COLUMN "statusChangedAt" TIMESTAMPTZ(3),
  ADD COLUMN "statusChangedById" UUID;

CREATE TABLE "review_reports" (
  "id" UUID NOT NULL,
  "reviewId" UUID NOT NULL,
  "reporterId" UUID NOT NULL,
  "reporterRole" "RoleCode" NOT NULL,
  "category" "ReviewReportCategory" NOT NULL,
  "description" VARCHAR(500) NOT NULL,
  "status" "ReviewReportStatus" NOT NULL DEFAULT 'OPEN',
  "resolutionNote" VARCHAR(500),
  "resolvedAt" TIMESTAMPTZ(3),
  "resolvedById" UUID,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "review_reports_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "review_reports_description_length_check"
    CHECK (char_length(btrim("description")) BETWEEN 10 AND 500),
  CONSTRAINT "review_reports_reporter_role_check"
    CHECK ("reporterRole" IN ('PARENT', 'TEACHER'))
);

CREATE UNIQUE INDEX "review_reports_reviewId_reporterId_key"
  ON "review_reports"("reviewId", "reporterId");

CREATE INDEX "review_reports_reporterId_reporterRole_createdAt_idx"
  ON "review_reports"("reporterId", "reporterRole", "createdAt" DESC);

CREATE INDEX "review_reports_status_createdAt_idx"
  ON "review_reports"("status", "createdAt" DESC);

CREATE INDEX "review_reports_reviewId_status_idx"
  ON "review_reports"("reviewId", "status");

ALTER TABLE "reviews"
  ADD CONSTRAINT "reviews_statusChangedById_fkey"
  FOREIGN KEY ("statusChangedById") REFERENCES "accounts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "review_reports"
  ADD CONSTRAINT "review_reports_reviewId_fkey"
  FOREIGN KEY ("reviewId") REFERENCES "reviews"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "review_reports"
  ADD CONSTRAINT "review_reports_reporterId_fkey"
  FOREIGN KEY ("reporterId") REFERENCES "accounts"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "review_reports"
  ADD CONSTRAINT "review_reports_resolvedById_fkey"
  FOREIGN KEY ("resolvedById") REFERENCES "accounts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
