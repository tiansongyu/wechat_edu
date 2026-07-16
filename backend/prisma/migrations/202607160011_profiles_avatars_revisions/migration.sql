-- Rich profiles, public avatar objects, auditable post revisions and an
-- application-bound conversation complete the core tutoring workflow.
ALTER TABLE "accounts"
  ADD COLUMN "avatarObjectKey" VARCHAR(500);

ALTER TABLE "parent_profiles"
  ADD COLUMN "studentNickname" VARCHAR(64),
  ADD COLUMN "studentGender" VARCHAR(20),
  ADD COLUMN "studentGrade" VARCHAR(64),
  ADD COLUMN "schoolName" VARCHAR(128),
  ADD COLUMN "currentLevel" VARCHAR(255),
  ADD COLUMN "targetGoal" VARCHAR(255),
  ADD COLUMN "weakSubjects" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "learningGoals" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "learningStyle" VARCHAR(64),
  ADD COLUMN "personalityNotes" VARCHAR(500),
  ADD COLUMN "preferredSchedule" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "tutorExpectations" VARCHAR(1000);

ALTER TABLE "teacher_profiles"
  ADD COLUMN "serviceAreas" JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN "displayTitle" VARCHAR(120),
  ADD COLUMN "teachingStyle" VARCHAR(1000),
  ADD COLUMN "teachingAchievements" VARCHAR(1000),
  ADD COLUMN "examExperience" VARCHAR(1000),
  ADD COLUMN "languages" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "availableTimes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "serviceModes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "lessonFormats" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE TABLE "job_revisions" (
  "id" UUID NOT NULL,
  "jobId" UUID NOT NULL,
  "requesterId" UUID NOT NULL,
  "proposedData" JSONB NOT NULL,
  "proposedContactEncrypted" TEXT,
  "contactChanged" BOOLEAN NOT NULL DEFAULT false,
  "status" "AuditStatus" NOT NULL DEFAULT 'PENDING',
  "auditNote" VARCHAR(500),
  "version" INTEGER NOT NULL DEFAULT 1,
  "reviewedAt" TIMESTAMPTZ(3),
  "reviewedById" UUID,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "job_revisions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "job_revisions_status_createdAt_idx"
  ON "job_revisions"("status", "createdAt");
CREATE INDEX "job_revisions_jobId_createdAt_idx"
  ON "job_revisions"("jobId", "createdAt" DESC);
CREATE UNIQUE INDEX "job_revisions_one_pending_per_job_idx"
  ON "job_revisions"("jobId") WHERE "status" = 'PENDING';

ALTER TABLE "job_revisions"
  ADD CONSTRAINT "job_revisions_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "job_posts"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "job_revisions"
  ADD CONSTRAINT "job_revisions_requesterId_fkey"
  FOREIGN KEY ("requesterId") REFERENCES "accounts"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "job_revisions"
  ADD CONSTRAINT "job_revisions_reviewedById_fkey"
  FOREIGN KEY ("reviewedById") REFERENCES "accounts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "conversations"
  ADD COLUMN "applicationId" UUID;
CREATE UNIQUE INDEX "conversations_applicationId_key"
  ON "conversations"("applicationId");
ALTER TABLE "conversations"
  ADD CONSTRAINT "conversations_applicationId_fkey"
  FOREIGN KEY ("applicationId") REFERENCES "applications"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
