-- AddCompletionAcknowledgements
ALTER TABLE "appointments"
  ADD COLUMN "parentCompletedAt" TIMESTAMPTZ(3),
  ADD COLUMN "teacherCompletedAt" TIMESTAMPTZ(3),
  ADD COLUMN "completedAt" TIMESTAMPTZ(3);

-- Historical COMPLETED rows came from the previous one-sided completion flow.
-- Leave acknowledgement timestamps NULL so they cannot silently gain review
-- eligibility; only a new two-party acknowledgement or an explicit admin
-- completion decision may populate all three timestamps.

-- AddIdempotencyRequestHash
ALTER TABLE "idempotency_records"
  ADD COLUMN "requestHash" VARCHAR(64);

-- AddOutboxProcessingLease
ALTER TABLE "outbox_events"
  ADD COLUMN "claimedAt" TIMESTAMPTZ(3);

-- CreateReviewStatus
CREATE TYPE "ReviewStatus" AS ENUM ('PUBLISHED', 'HIDDEN', 'REMOVED');

-- CreateReviews
CREATE TABLE "reviews" (
  "id" UUID NOT NULL,
  "appointmentId" UUID NOT NULL,
  "reviewerId" UUID NOT NULL,
  "revieweeId" UUID NOT NULL,
  "reviewerRole" "RoleCode" NOT NULL,
  "revieweeRole" "RoleCode" NOT NULL,
  "rating" INTEGER NOT NULL,
  "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "content" TEXT,
  "status" "ReviewStatus" NOT NULL DEFAULT 'PUBLISHED',
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "reviews_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "reviews_rating_check" CHECK ("rating" BETWEEN 1 AND 5),
  CONSTRAINT "reviews_reviewer_reviewee_check" CHECK ("reviewerId" <> "revieweeId")
);

CREATE UNIQUE INDEX "reviews_appointmentId_reviewerId_key"
  ON "reviews"("appointmentId", "reviewerId");

CREATE INDEX "reviews_revieweeId_status_createdAt_idx"
  ON "reviews"("revieweeId", "status", "createdAt" DESC);

ALTER TABLE "reviews"
  ADD CONSTRAINT "reviews_appointmentId_fkey"
  FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "reviews"
  ADD CONSTRAINT "reviews_reviewerId_fkey"
  FOREIGN KEY ("reviewerId") REFERENCES "accounts"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "reviews"
  ADD CONSTRAINT "reviews_revieweeId_fkey"
  FOREIGN KEY ("revieweeId") REFERENCES "accounts"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
