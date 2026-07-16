import "dotenv/config";
import * as argon2 from "argon2";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import {
  ApplicationStatus,
  AppointmentStatus,
  AuditStatus,
  JobStatus,
  JobType,
  NotificationType,
  ReviewReportCategory,
  ReviewReportStatus,
  ReviewStatus,
  RoleCode
} from "../src/generated/prisma/enums";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const ADMIN_ID = "018f1ef0-0000-7000-8000-000000000001";
const PARENT_ID = "018f1ef0-0000-7000-8000-000000000002";
const TEACHER_ID = "018f1ef0-0000-7000-8000-000000000003";
const JOB_ID = "018f1ef0-0000-7000-8000-000000000101";
const APPLICATION_ID = "018f1ef0-0000-7000-8000-000000000201";
const APPOINTMENT_ID = "018f1ef0-0000-7000-8000-000000000301";
const CONVERSATION_ID = "018f1ef0-0000-7000-8000-000000000401";
const MESSAGE_ID = "018f1ef0-0000-7000-8000-000000000501";
const NOTIFICATION_ID = "018f1ef0-0000-7000-8000-000000000601";
const AUDIT_ID = "018f1ef0-0000-7000-8000-000000000701";
const REVIEW_ID = "018f1ef0-0000-7000-8000-000000000801";
const REVIEW_REPORT_ID = "018f1ef0-0000-7000-8000-000000000901";
const CONVERSATION_CONTEXT_KEY = `job:${JOB_ID}:parent:${PARENT_ID}:teacher:${TEACHER_ID}`;

async function main() {
  await Promise.all([
    prisma.role.upsert({ where: { code: RoleCode.PARENT }, update: {}, create: { code: RoleCode.PARENT, name: "家长" } }),
    prisma.role.upsert({ where: { code: RoleCode.TEACHER }, update: {}, create: { code: RoleCode.TEACHER, name: "老师" } }),
    prisma.role.upsert({ where: { code: RoleCode.ADMIN }, update: {}, create: { code: RoleCode.ADMIN, name: "管理员" } })
  ]);

  const adminUsername = process.env.ADMIN_USERNAME || "admin";
  const existingAdmin = await prisma.account.findFirst({
    where: { OR: [{ id: ADMIN_ID }, { username: adminUsername }] },
    select: { id: true }
  });
  const adminId = existingAdmin?.id || ADMIN_ID;
  if (!existingAdmin) {
    const adminPassword = await argon2.hash(process.env.ADMIN_PASSWORD || "Admin123456!", { type: argon2.argon2id });
    await prisma.account.create({
      data: {
        id: ADMIN_ID,
        username: adminUsername,
        passwordHash: adminPassword,
        nickname: "系统管理员",
        roles: { create: [{ roleCode: RoleCode.ADMIN }] }
      }
    });
  } else {
    await prisma.accountRole.upsert({
      where: { accountId_roleCode: { accountId: existingAdmin.id, roleCode: RoleCode.ADMIN } },
      update: {},
      create: { accountId: existingAdmin.id, roleCode: RoleCode.ADMIN }
    });
  }

  if (process.env.SEED_DEMO_DATA === "true") {
    const sampleCompletedAt = new Date("2026-07-15T08:00:00.000Z");
    await prisma.account.upsert({
      where: { id: PARENT_ID },
      update: {},
      create: {
        id: PARENT_ID,
        openid: "seed_parent_openid",
        nickname: "林女士",
        roles: { create: [{ roleCode: RoleCode.PARENT }] },
        preference: { create: {} },
        parentProfile: {
          create: {
            province: "广东省",
            city: "深圳市",
            district: "南山区",
            address: "深圳市南山区科技园",
            latitude: 22.54042,
            longitude: 113.93457,
            studentNickname: "小林",
            studentGrade: "高一",
            currentLevel: "数学基础中等，函数题容易丢分",
            targetGoal: "稳定提升到班级前二十",
            weakSubjects: ["数学"],
            learningGoals: ["查漏补缺", "学习习惯"],
            preferredSchedule: ["周六下午"]
          }
        }
      }
    });

    await prisma.account.upsert({
      where: { id: TEACHER_ID },
      update: {},
      create: {
        id: TEACHER_ID,
        openid: "seed_teacher_openid",
        nickname: "陈老师",
        roles: { create: [{ roleCode: RoleCode.TEACHER }] },
        preference: { create: {} },
        teacherProfile: {
          create: {
            realName: "陈老师",
            bio: "数学教育专业，擅长初高中数学提分与学习习惯培养。",
            school: "华南师范大学",
            major: "数学教育",
            education: "本科",
            teachingYears: 4,
            hourlyRateCents: 20000,
            subjects: ["数学"],
            serviceDistricts: ["广东省 / 深圳市 / 南山区"],
            serviceAreas: [{ province: "广东省", city: "深圳市", district: "南山区" }],
            displayTitle: "初高中数学提分与习惯培养",
            teachingStyle: "先诊断薄弱点，再用例题和复盘形成闭环。",
            languages: ["普通话"],
            availableTimes: ["周末下午"],
            serviceModes: ["上门", "在线"],
            lessonFormats: ["一对一"],
            auditStatus: AuditStatus.APPROVED,
            submittedAt: new Date(),
            score: 92
          }
        }
      }
    });

    await prisma.jobPost.upsert({
      where: { id: JOB_ID },
      update: {},
      create: {
        id: JOB_ID,
        ownerId: PARENT_ID,
        type: JobType.TEACHING_NEED,
        title: "高一数学辅导（双休 / 可长期）",
        province: "广东省",
        city: "深圳市",
        district: "南山区",
        area: "科技园",
        grade: "高一",
        subject: "数学",
        priceCents: 20000,
        priceUnit: "小时",
        settlement: "周结",
        schedule: "周六、周日 14:00–16:00",
        description: "重点辅导几何与函数，需要讲课清晰并有家教经验。",
        studentInfo: "1名高一学生，基础中等",
        address: "南山区科技园地铁站附近",
        latitude: 22.54042,
        longitude: 113.93457,
        status: JobStatus.PUBLISHED,
        capacity: 2,
        applicationCount: 1,
        publishedAt: new Date()
      }
    });

    await prisma.$executeRawUnsafe(
      `UPDATE job_posts SET location = ST_SetSRID(ST_MakePoint("longitude"::double precision, "latitude"::double precision), 4326)::geography WHERE "longitude" IS NOT NULL AND "latitude" IS NOT NULL`
    );

    await prisma.application.upsert({
      where: { id: APPLICATION_ID },
      update: {},
      create: {
        id: APPLICATION_ID,
        jobId: JOB_ID,
        teacherId: TEACHER_ID,
        coverLetter: "系统保留的一条完整业务样本。",
        status: ApplicationStatus.ACCEPTED,
        statusNote: "样本数据：已录用",
        handledAt: new Date()
      }
    });
    await prisma.appointment.upsert({
      where: { id: APPOINTMENT_ID },
      update: {},
      create: {
        id: APPOINTMENT_ID,
        jobId: JOB_ID,
        applicationId: APPLICATION_ID,
        status: AppointmentStatus.COMPLETED,
        note: "系统保留的一条合作预约样本。",
        statusNote: "样本数据：双方已确认完成",
        parentCompletedAt: sampleCompletedAt,
        teacherCompletedAt: sampleCompletedAt,
        completedAt: sampleCompletedAt,
        handledAt: sampleCompletedAt
      }
    });
    await prisma.review.upsert({
      where: { appointmentId_reviewerId: { appointmentId: APPOINTMENT_ID, reviewerId: PARENT_ID } },
      update: {},
      create: {
        id: REVIEW_ID,
        appointmentId: APPOINTMENT_ID,
        reviewerId: PARENT_ID,
        revieweeId: TEACHER_ID,
        reviewerRole: RoleCode.PARENT,
        revieweeRole: RoleCode.TEACHER,
        rating: 5,
        tags: ["专业耐心", "准时守约"],
        content: "讲解清晰耐心，孩子很容易理解。",
        status: ReviewStatus.PUBLISHED
      }
    });
    await prisma.reviewReport.upsert({
      where: { reviewId_reporterId: { reviewId: REVIEW_ID, reporterId: TEACHER_ID } },
      update: {},
      create: {
        id: REVIEW_REPORT_ID,
        reviewId: REVIEW_ID,
        reporterId: TEACHER_ID,
        reporterRole: RoleCode.TEACHER,
        category: ReviewReportCategory.OTHER,
        description: "样例举报用于验证后台治理流程，请勿作为真实投诉处理。",
        status: ReviewReportStatus.OPEN
      }
    });
    await prisma.favorite.upsert({
      where: { accountId_jobId: { accountId: TEACHER_ID, jobId: JOB_ID } },
      update: {},
      create: { accountId: TEACHER_ID, jobId: JOB_ID }
    });
    await prisma.conversation.upsert({
      where: { id: CONVERSATION_ID },
      update: { jobId: JOB_ID, applicationId: APPLICATION_ID, contextKey: CONVERSATION_CONTEXT_KEY },
      create: { id: CONVERSATION_ID, jobId: JOB_ID, applicationId: APPLICATION_ID, contextKey: CONVERSATION_CONTEXT_KEY }
    });
    for (const member of [
      { accountId: PARENT_ID, role: RoleCode.PARENT },
      { accountId: TEACHER_ID, role: RoleCode.TEACHER }
    ]) {
      await prisma.conversationMember.upsert({
        where: { conversationId_accountId: { conversationId: CONVERSATION_ID, accountId: member.accountId } },
        update: { role: member.role },
        create: { conversationId: CONVERSATION_ID, accountId: member.accountId, role: member.role, lastReadAt: new Date() }
      });
    }
    await prisma.message.upsert({
      where: { id: MESSAGE_ID },
      update: {},
      create: {
        id: MESSAGE_ID,
        conversationId: CONVERSATION_ID,
        senderId: PARENT_ID,
        clientMessageId: MESSAGE_ID,
        content: "您好，这是系统保留的一条会话样本。"
      }
    });
    await prisma.notification.upsert({
      where: { id: NOTIFICATION_ID },
      update: {},
      create: {
        id: NOTIFICATION_ID,
        accountId: TEACHER_ID,
        type: NotificationType.SYSTEM,
        title: "样本通知",
        content: "系统仅保留这一条通知样本。",
        readAt: new Date()
      }
    });
    await prisma.auditLog.upsert({
      where: { id: AUDIT_ID },
      update: {},
      create: {
        id: AUDIT_ID,
        actorId: adminId,
        action: "sample.retained",
        targetType: "System",
        targetId: JOB_ID,
        after: { sample: true, businessRecords: 1 }
      }
    });
  }

  await prisma.systemSetting.upsert({
    where: { key: "platform" },
    update: {},
    create: { key: "platform", value: { name: "家教直聘", teacherAuditRequired: true, jobAuditRequired: true } }
  });
  await prisma.systemSetting.upsert({
    where: { key: "platform.public" },
    update: {},
    create: {
      key: "platform.public",
      value: {
        brand: { name: "家教直聘", slogan: "认真匹配每一次教与学" },
        trustHighlights: ["教师资料经平台审核", "真实合作才能评价", "隐私信息分级保护"]
      }
    }
  });
}

main()
  .then(() => console.log("Database seed completed."))
  .finally(() => prisma.$disconnect());
