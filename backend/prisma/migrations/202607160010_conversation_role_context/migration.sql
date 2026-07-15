-- Persist the business context and each participant's active role so a dual-role
-- account can never reuse a conversation across its parent and teacher identities.
-- Existing rows stay nullable and are lazily backfilled only when the service can
-- derive exactly one historical job/role context for both participants.
ALTER TABLE "conversations"
  ADD COLUMN "jobId" UUID,
  ADD COLUMN "contextKey" VARCHAR(160);

ALTER TABLE "conversation_members"
  ADD COLUMN "role" "RoleCode";

ALTER TABLE "conversation_members"
  ADD CONSTRAINT "conversation_members_role_check"
  CHECK ("role" IS NULL OR "role" IN ('PARENT', 'TEACHER'));

CREATE UNIQUE INDEX "conversations_contextKey_key"
  ON "conversations"("contextKey");

CREATE INDEX "conversations_jobId_updatedAt_idx"
  ON "conversations"("jobId", "updatedAt" DESC);

DROP INDEX "conversation_members_accountId_createdAt_idx";

CREATE INDEX "conversation_members_accountId_role_createdAt_idx"
  ON "conversation_members"("accountId", "role", "createdAt" DESC);

ALTER TABLE "conversations"
  ADD CONSTRAINT "conversations_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "job_posts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- An outbox event may legitimately notify both appointment participants. Keep
-- delivery idempotent per recipient instead of globally suppressing the second
-- notification for the same event.
DROP INDEX "notifications_sourceEventId_key";

CREATE UNIQUE INDEX "notifications_accountId_sourceEventId_key"
  ON "notifications"("accountId", "sourceEventId");
