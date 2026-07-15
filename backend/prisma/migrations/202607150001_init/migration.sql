-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- Enable geospatial types and indexes used by nearby-job queries.
CREATE EXTENSION IF NOT EXISTS postgis;

-- CreateEnum
CREATE TYPE "RoleCode" AS ENUM ('PARENT', 'TEACHER', 'ADMIN');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DELETED');

-- CreateEnum
CREATE TYPE "AuditStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('TEACHING_NEED', 'TEACHER_OFFER');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('DRAFT', 'PENDING', 'PUBLISHED', 'CLOSED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('APPLICATION', 'AUDIT', 'CHAT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'PUBLISHED', 'FAILED');

-- CreateTable
CREATE TABLE "accounts" (
    "id" UUID NOT NULL,
    "openid" VARCHAR(128),
    "unionid" VARCHAR(128),
    "username" VARCHAR(64),
    "passwordHash" VARCHAR(255),
    "nickname" VARCHAR(80) NOT NULL DEFAULT '微信用户',
    "avatarUrl" VARCHAR(500),
    "phoneEncrypted" TEXT,
    "phoneHash" VARCHAR(128),
    "status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "code" "RoleCode" NOT NULL,
    "name" VARCHAR(32) NOT NULL,
    "description" VARCHAR(255),

    CONSTRAINT "roles_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "account_roles" (
    "accountId" UUID NOT NULL,
    "roleCode" "RoleCode" NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_roles_pkey" PRIMARY KEY ("accountId","roleCode")
);

-- CreateTable
CREATE TABLE "parent_profiles" (
    "accountId" UUID NOT NULL,
    "city" VARCHAR(64),
    "district" VARCHAR(64),
    "address" VARCHAR(255),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "parent_profiles_pkey" PRIMARY KEY ("accountId")
);

-- CreateTable
CREATE TABLE "teacher_profiles" (
    "accountId" UUID NOT NULL,
    "realName" VARCHAR(64),
    "bio" TEXT,
    "school" VARCHAR(128),
    "major" VARCHAR(128),
    "education" VARCHAR(64),
    "teachingYears" INTEGER NOT NULL DEFAULT 0,
    "hourlyRateCents" INTEGER,
    "subjects" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "serviceDistricts" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "auditStatus" "AuditStatus" NOT NULL DEFAULT 'PENDING',
    "auditNote" VARCHAR(500),
    "score" INTEGER NOT NULL DEFAULT 60,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "teacher_profiles_pkey" PRIMARY KEY ("accountId")
);

-- CreateTable
CREATE TABLE "teacher_certifications" (
    "id" UUID NOT NULL,
    "teacherId" UUID NOT NULL,
    "type" VARCHAR(64) NOT NULL,
    "fileUrl" VARCHAR(500) NOT NULL,
    "auditStatus" "AuditStatus" NOT NULL DEFAULT 'PENDING',
    "auditNote" VARCHAR(500),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "teacher_certifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_posts" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "type" "JobType" NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "district" VARCHAR(64) NOT NULL,
    "area" VARCHAR(128),
    "grade" VARCHAR(64) NOT NULL,
    "subject" VARCHAR(64) NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "priceUnit" VARCHAR(32) NOT NULL DEFAULT '小时',
    "settlement" VARCHAR(32) NOT NULL DEFAULT '课结',
    "schedule" VARCHAR(255) NOT NULL,
    "description" TEXT NOT NULL,
    "studentInfo" VARCHAR(500),
    "address" VARCHAR(255),
    "contactEncrypted" TEXT,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "location" geography(Point, 4326),
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "capacity" INTEGER NOT NULL DEFAULT 1,
    "applicationCount" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "auditNote" VARCHAR(500),
    "publishedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "job_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "applications" (
    "id" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "teacherId" UUID NOT NULL,
    "coverLetter" VARCHAR(1000),
    "status" "ApplicationStatus" NOT NULL DEFAULT 'PENDING',
    "version" INTEGER NOT NULL DEFAULT 1,
    "handledAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointments" (
    "id" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'PENDING',
    "startAt" TIMESTAMPTZ(3),
    "note" VARCHAR(1000),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "favorites" (
    "accountId" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "favorites_pkey" PRIMARY KEY ("accountId","jobId")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_members" (
    "conversationId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "lastReadAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_members_pkey" PRIMARY KEY ("conversationId","accountId")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "senderId" UUID NOT NULL,
    "clientMessageId" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "content" VARCHAR(1000) NOT NULL,
    "data" JSONB,
    "readAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_sessions" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "tokenHash" VARCHAR(128) NOT NULL,
    "userAgent" VARCHAR(500),
    "ipAddress" VARCHAR(64),
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "refresh_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_records" (
    "id" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "scope" VARCHAR(80) NOT NULL,
    "key" VARCHAR(128) NOT NULL,
    "response" JSONB NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL,
    "aggregateType" VARCHAR(80) NOT NULL,
    "aggregateId" UUID NOT NULL,
    "eventType" VARCHAR(120) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMPTZ(3),
    "lastError" VARCHAR(1000),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actorId" UUID,
    "action" VARCHAR(120) NOT NULL,
    "targetType" VARCHAR(80) NOT NULL,
    "targetId" VARCHAR(128),
    "before" JSONB,
    "after" JSONB,
    "ipAddress" VARCHAR(64),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "key" VARCHAR(120) NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "accounts_openid_key" ON "accounts"("openid");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_unionid_key" ON "accounts"("unionid");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_username_key" ON "accounts"("username");

-- CreateIndex
CREATE INDEX "account_roles_roleCode_idx" ON "account_roles"("roleCode");

-- CreateIndex
CREATE INDEX "teacher_profiles_auditStatus_createdAt_idx" ON "teacher_profiles"("auditStatus", "createdAt");

-- CreateIndex
CREATE INDEX "teacher_certifications_auditStatus_createdAt_idx" ON "teacher_certifications"("auditStatus", "createdAt");

-- CreateIndex
CREATE INDEX "job_posts_status_type_district_subject_publishedAt_idx" ON "job_posts"("status", "type", "district", "subject", "publishedAt" DESC);

-- CreateIndex
CREATE INDEX "job_posts_ownerId_status_createdAt_idx" ON "job_posts"("ownerId", "status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "applications_teacherId_status_createdAt_idx" ON "applications"("teacherId", "status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "applications_jobId_status_createdAt_idx" ON "applications"("jobId", "status", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "applications_jobId_teacherId_key" ON "applications"("jobId", "teacherId");

-- CreateIndex
CREATE UNIQUE INDEX "appointments_applicationId_key" ON "appointments"("applicationId");

-- CreateIndex
CREATE INDEX "appointments_jobId_status_idx" ON "appointments"("jobId", "status");

-- CreateIndex
CREATE INDEX "favorites_jobId_idx" ON "favorites"("jobId");

-- CreateIndex
CREATE INDEX "conversation_members_accountId_createdAt_idx" ON "conversation_members"("accountId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "messages_conversationId_createdAt_id_idx" ON "messages"("conversationId", "createdAt" DESC, "id");

-- CreateIndex
CREATE UNIQUE INDEX "messages_conversationId_senderId_clientMessageId_key" ON "messages"("conversationId", "senderId", "clientMessageId");

-- CreateIndex
CREATE INDEX "notifications_accountId_readAt_createdAt_idx" ON "notifications"("accountId", "readAt", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "refresh_sessions_accountId_expiresAt_idx" ON "refresh_sessions"("accountId", "expiresAt");

-- CreateIndex
CREATE INDEX "idempotency_records_expiresAt_idx" ON "idempotency_records"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_records_actorId_scope_key_key" ON "idempotency_records"("actorId", "scope", "key");

-- CreateIndex
CREATE INDEX "outbox_events_status_availableAt_createdAt_idx" ON "outbox_events"("status", "availableAt", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_actorId_createdAt_idx" ON "audit_logs"("actorId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_targetType_targetId_createdAt_idx" ON "audit_logs"("targetType", "targetId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "account_roles" ADD CONSTRAINT "account_roles_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_roles" ADD CONSTRAINT "account_roles_roleCode_fkey" FOREIGN KEY ("roleCode") REFERENCES "roles"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parent_profiles" ADD CONSTRAINT "parent_profiles_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_profiles" ADD CONSTRAINT "teacher_profiles_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_certifications" ADD CONSTRAINT "teacher_certifications_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "teacher_profiles"("accountId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_posts" ADD CONSTRAINT "job_posts_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "job_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "job_posts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "job_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_members" ADD CONSTRAINT "conversation_members_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_members" ADD CONSTRAINT "conversation_members_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_sessions" ADD CONSTRAINT "refresh_sessions_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- PostGIS and high-volume feed indexes are intentionally maintained as SQL migrations.
CREATE INDEX "job_posts_location_gist_idx" ON "job_posts" USING GIST ("location");
CREATE INDEX "job_posts_published_feed_idx"
  ON "job_posts" ("type", "district", "publishedAt" DESC, "id" DESC)
  WHERE "status" = 'PUBLISHED';
