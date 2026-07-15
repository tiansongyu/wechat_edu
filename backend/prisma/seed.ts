import "dotenv/config";
import * as argon2 from "argon2";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { AuditStatus, JobStatus, JobType, RoleCode } from "../src/generated/prisma/enums";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const ADMIN_ID = "018f1ef0-0000-7000-8000-000000000001";
const PARENT_ID = "018f1ef0-0000-7000-8000-000000000002";
const TEACHER_ID = "018f1ef0-0000-7000-8000-000000000003";
const JOB_ID = "018f1ef0-0000-7000-8000-000000000101";
const OFFER_ID = "018f1ef0-0000-7000-8000-000000000102";

async function main() {
  await Promise.all([
    prisma.role.upsert({ where: { code: RoleCode.PARENT }, update: {}, create: { code: RoleCode.PARENT, name: "家长" } }),
    prisma.role.upsert({ where: { code: RoleCode.TEACHER }, update: {}, create: { code: RoleCode.TEACHER, name: "老师" } }),
    prisma.role.upsert({ where: { code: RoleCode.ADMIN }, update: {}, create: { code: RoleCode.ADMIN, name: "管理员" } })
  ]);

  const adminPassword = await argon2.hash(process.env.ADMIN_PASSWORD || "Admin123456!", { type: argon2.argon2id });
  await prisma.account.upsert({
    where: { id: ADMIN_ID },
    update: { username: process.env.ADMIN_USERNAME || "admin", passwordHash: adminPassword },
    create: {
      id: ADMIN_ID,
      username: process.env.ADMIN_USERNAME || "admin",
      passwordHash: adminPassword,
      nickname: "系统管理员",
      roles: { create: [{ roleCode: RoleCode.ADMIN }] }
    }
  });

  await prisma.account.upsert({
    where: { id: PARENT_ID },
    update: {},
    create: {
      id: PARENT_ID,
      openid: "seed_parent_openid",
      nickname: "林女士",
      roles: { create: [{ roleCode: RoleCode.PARENT }] },
      parentProfile: { create: { city: "深圳", district: "南山区", address: "科技园" } }
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
          serviceDistricts: ["南山区", "福田区"],
          auditStatus: AuditStatus.APPROVED,
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
      publishedAt: new Date()
    }
  });

  await prisma.jobPost.upsert({
    where: { id: OFFER_ID },
    update: {},
    create: {
      id: OFFER_ID,
      ownerId: TEACHER_ID,
      type: JobType.TEACHER_OFFER,
      title: "华师数学老师可带初高中数学",
      district: "南山区",
      area: "科技园",
      grade: "初中/高中",
      subject: "数学",
      priceCents: 20000,
      priceUnit: "小时",
      settlement: "课结",
      schedule: "工作日晚间、周末可协商",
      description: "四年家教经验，注重错题分析和阶段性学习计划。",
      address: "南山区、福田区可上门",
      latitude: 22.54212,
      longitude: 113.94120,
      status: JobStatus.PUBLISHED,
      publishedAt: new Date()
    }
  });

  await prisma.$executeRawUnsafe(
    `UPDATE job_posts SET location = ST_SetSRID(ST_MakePoint("longitude"::double precision, "latitude"::double precision), 4326)::geography WHERE "longitude" IS NOT NULL AND "latitude" IS NOT NULL`
  );
  await prisma.systemSetting.upsert({
    where: { key: "platform" },
    update: {},
    create: { key: "platform", value: { name: "家教直聘", teacherAuditRequired: true, jobAuditRequired: true } }
  });
}

main()
  .then(() => console.log("Database seed completed."))
  .finally(() => prisma.$disconnect());
