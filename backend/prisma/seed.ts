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
            longitude: 113.93457
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
        status: AppointmentStatus.CONFIRMED,
        note: "系统保留的一条合作预约样本。",
        handledAt: new Date()
      }
    });
    await prisma.favorite.upsert({
      where: { accountId_jobId: { accountId: TEACHER_ID, jobId: JOB_ID } },
      update: {},
      create: { accountId: TEACHER_ID, jobId: JOB_ID }
    });
    await prisma.conversation.upsert({ where: { id: CONVERSATION_ID }, update: {}, create: { id: CONVERSATION_ID } });
    for (const accountId of [PARENT_ID, TEACHER_ID]) {
      await prisma.conversationMember.upsert({
        where: { conversationId_accountId: { conversationId: CONVERSATION_ID, accountId } },
        update: {},
        create: { conversationId: CONVERSATION_ID, accountId, lastReadAt: new Date() }
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
        actorId: ADMIN_ID,
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
}

main()
  .then(() => console.log("Database seed completed."))
  .finally(() => prisma.$disconnect());
