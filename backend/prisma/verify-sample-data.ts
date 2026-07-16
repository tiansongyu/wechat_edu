import "dotenv/config";
import assert from "node:assert/strict";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { ApplicationStatus, AppointmentStatus, ReviewReportStatus, ReviewStatus, RoleCode } from "../src/generated/prisma/enums";

const PARENT_ID = "018f1ef0-0000-7000-8000-000000000002";
const TEACHER_ID = "018f1ef0-0000-7000-8000-000000000003";
const JOB_ID = "018f1ef0-0000-7000-8000-000000000101";
const APPLICATION_ID = "018f1ef0-0000-7000-8000-000000000201";
const APPOINTMENT_ID = "018f1ef0-0000-7000-8000-000000000301";
const REVIEW_ID = "018f1ef0-0000-7000-8000-000000000801";
const CONVERSATION_ID = "018f1ef0-0000-7000-8000-000000000401";
const CONVERSATION_CONTEXT_KEY = `job:${JOB_ID}:parent:${PARENT_ID}:teacher:${TEACHER_ID}`;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function main() {
  const counts = Object.fromEntries(await Promise.all([
    ["accounts", prisma.account.count()],
    ["accountRoles", prisma.accountRole.count()],
    ["parentProfiles", prisma.parentProfile.count()],
    ["teacherProfiles", prisma.teacherProfile.count()],
    ["teacherCertifications", prisma.teacherCertification.count()],
    ["userPreferences", prisma.userPreference.count()],
    ["jobs", prisma.jobPost.count()],
    ["jobRevisions", prisma.jobRevision.count()],
    ["applications", prisma.application.count()],
    ["appointments", prisma.appointment.count()],
    ["reviews", prisma.review.count()],
    ["reviewReports", prisma.reviewReport.count()],
    ["favorites", prisma.favorite.count()],
    ["conversations", prisma.conversation.count()],
    ["conversationMembers", prisma.conversationMember.count()],
    ["messages", prisma.message.count()],
    ["notifications", prisma.notification.count()],
    ["auditLogs", prisma.auditLog.count()],
    ["outboxEvents", prisma.outboxEvent.count()],
    ["idempotencyRecords", prisma.idempotencyRecord.count()],
    ["refreshSessions", prisma.refreshSession.count()]
  ].map(async ([name, countPromise]) => [name, await countPromise] as const)));

  const expectedCounts: Record<string, number> = {
    accounts: 3,
    accountRoles: 3,
    parentProfiles: 1,
    teacherProfiles: 1,
    teacherCertifications: 0,
    userPreferences: 2,
    jobs: 1,
    jobRevisions: 0,
    applications: 1,
    appointments: 1,
    reviews: 1,
    reviewReports: 1,
    favorites: 1,
    conversations: 1,
    conversationMembers: 2,
    messages: 1,
    notifications: 1,
    auditLogs: 1,
    outboxEvents: 0,
    idempotencyRecords: 0,
    refreshSessions: 0
  };
  assert.deepEqual(counts, expectedCounts, "sample reset must retain only the documented linked dataset");

  const sample = await prisma.jobPost.findUnique({
    where: { id: JOB_ID },
    include: {
      applications: {
        include: {
          appointment: {
            include: {
              reviews: { include: { reports: true } }
            }
          }
        }
      }
    }
  });
  assert.ok(sample, "sample job must exist");
  assert.equal(sample.ownerId, PARENT_ID);
  assert.equal(sample.applications.length, 1);
  const application = sample.applications[0];
  assert.equal(application.id, APPLICATION_ID);
  assert.equal(application.teacherId, TEACHER_ID);
  assert.equal(application.status, ApplicationStatus.ACCEPTED);
  assert.equal(application.appointment?.id, APPOINTMENT_ID);
  assert.equal(application.appointment?.status, AppointmentStatus.COMPLETED);
  assert.ok(application.appointment?.parentCompletedAt);
  assert.ok(application.appointment?.teacherCompletedAt);
  assert.ok(application.appointment?.completedAt);

  const review = application.appointment?.reviews[0];
  assert.equal(review?.id, REVIEW_ID);
  assert.equal(review?.reviewerId, PARENT_ID);
  assert.equal(review?.revieweeId, TEACHER_ID);
  assert.equal(review?.reviewerRole, RoleCode.PARENT);
  assert.equal(review?.revieweeRole, RoleCode.TEACHER);
  assert.equal(review?.status, ReviewStatus.PUBLISHED);
  assert.equal(review?.reports.length, 1);
  assert.equal(review?.reports[0].reporterId, TEACHER_ID);
  assert.equal(review?.reports[0].status, ReviewReportStatus.OPEN);

  const conversation = await prisma.conversation.findUnique({
    where: { id: CONVERSATION_ID },
    include: { members: { orderBy: { accountId: "asc" } } }
  });
  assert.ok(conversation, "sample conversation must exist");
  assert.equal(conversation.jobId, JOB_ID);
  assert.equal(conversation.applicationId, APPLICATION_ID);
  assert.equal(conversation.contextKey, CONVERSATION_CONTEXT_KEY);
  assert.deepEqual(
    conversation.members.map((member) => [member.accountId, member.role]),
    [
      [PARENT_ID, RoleCode.PARENT],
      [TEACHER_ID, RoleCode.TEACHER]
    ],
    "sample conversation members must retain explicit role bindings"
  );

  console.log("Sample data verification passed: one referentially consistent PostgreSQL business dataset retained.");
}

main()
  .finally(() => prisma.$disconnect());
