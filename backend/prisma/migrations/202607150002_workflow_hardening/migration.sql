-- Workflow hardening: persistent command reasons, user preferences and
-- notification de-duplication for transactional outbox consumers.
ALTER TABLE "applications" ADD COLUMN "statusNote" VARCHAR(1000);

ALTER TABLE "teacher_profiles" ADD COLUMN "submittedAt" TIMESTAMPTZ(3);

ALTER TABLE "appointments"
  ADD COLUMN "statusNote" VARCHAR(1000),
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "handledAt" TIMESTAMPTZ(3);

ALTER TABLE "notifications" ADD COLUMN "sourceEventId" UUID;
CREATE UNIQUE INDEX "notifications_sourceEventId_key" ON "notifications"("sourceEventId");

CREATE TABLE "user_preferences" (
  "accountId" UUID NOT NULL,
  "jobNotice" BOOLEAN NOT NULL DEFAULT true,
  "chatNotice" BOOLEAN NOT NULL DEFAULT true,
  "privacyMode" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("accountId")
);

ALTER TABLE "user_preferences"
  ADD CONSTRAINT "user_preferences_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "accounts"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
