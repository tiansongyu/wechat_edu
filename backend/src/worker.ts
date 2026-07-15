import "reflect-metadata";
import { PrismaPg } from "@prisma/adapter-pg";
import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import { PrismaClient } from "./generated/prisma/client";
import { OutboxStatus } from "./generated/prisma/enums";

const connectionString = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;
if (!connectionString || !redisUrl) throw new Error("DATABASE_URL and REDIS_URL are required");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const redis = new IORedis(redisUrl, { maxRetriesPerRequest: null });
const queue = new Queue("domain-events", { connection: redis as any });

const worker = new Worker(
  "domain-events",
  async (job) => {
    const event = await prisma.outboxEvent.findUnique({ where: { id: job.data.eventId } });
    if (!event || event.status === OutboxStatus.PUBLISHED) return;
    const claimed = await prisma.outboxEvent.updateMany({
      where: { id: event.id, status: { in: [OutboxStatus.PENDING, OutboxStatus.FAILED] } },
      data: { status: OutboxStatus.PROCESSING, attempts: { increment: 1 }, lastError: null }
    });
    if (!claimed.count) return;
    const payload = event.payload as Record<string, string | null>;
    try {
      const notify = async (accountId: string, title: string, content: string, data: Record<string, string | null>) => {
        const preference = await prisma.userPreference.findUnique({ where: { accountId }, select: { jobNotice: true } });
        if (preference?.jobNotice === false) return;
        await prisma.notification.upsert({
          where: { sourceEventId: event.id },
          update: {},
          create: { accountId, type: event.aggregateType === "Appointment" ? "SYSTEM" : "APPLICATION", title, content, data, sourceEventId: event.id }
        });
      };
      if (event.eventType === "application.created" && payload.ownerId) {
        await notify(payload.ownerId, "收到新的老师报名", "你的家教需求收到一份新的报名，请及时处理。", {
          applicationId: payload.applicationId,
          jobId: payload.jobId
        });
      }
      if ((event.eventType === "application.accepted" || event.eventType === "application.rejected") && payload.teacherId) {
        const accepted = event.eventType === "application.accepted";
        await notify(
          payload.teacherId,
          accepted ? "报名已被接受" : "报名结果已更新",
          accepted ? "家长已接受你的报名，请进入消息中心继续沟通。" : payload.note || "本次报名未被选中，可以继续查看其他需求。",
          { applicationId: payload.applicationId, jobId: payload.jobId }
        );
      }
      if (event.eventType === "application.cancelled") {
        const recipient = payload.actorId === payload.teacherId ? payload.ownerId : payload.teacherId;
        if (recipient) {
          await notify(recipient, "报名已取消", payload.note || "一条报名记录已被取消。", {
            applicationId: payload.applicationId,
            jobId: payload.jobId
          });
        }
      }
      if (event.eventType.startsWith("appointment.")) {
        const recipient = payload.actorId === payload.teacherId ? payload.ownerId : payload.teacherId;
        if (recipient) {
          const labels: Record<string, [string, string]> = {
            "appointment.confirmed": ["预约已确认", "教师已确认本次预约。"],
            "appointment.completed": ["预约已完成", "本次预约已标记完成。"],
            "appointment.cancelled": ["预约已取消", payload.reason || "本次预约已取消。"],
            "appointment.disputed": ["预约产生争议", payload.reason || "对方针对本次预约发起了争议。"]
          };
          const [title, content] = labels[event.eventType] || ["预约状态已更新", "预约状态发生变化，请及时查看。"];
          await notify(recipient, title, content, { appointmentId: payload.appointmentId, jobId: payload.jobId });
        }
      }
      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: { status: OutboxStatus.PUBLISHED, processedAt: new Date(), lastError: null }
      });
    } catch (error) {
      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: {
          status: OutboxStatus.FAILED,
          lastError: error instanceof Error ? error.message.slice(0, 1000) : "Unknown worker error",
          availableAt: new Date(Date.now() + Math.min(60_000, 1000 * 2 ** Math.min(event.attempts, 6)))
        }
      });
      throw error;
    }
  },
  { connection: redis as any, concurrency: Number(process.env.WORKER_CONCURRENCY || 10) }
);

async function dispatchOutbox() {
  const events = await prisma.outboxEvent.findMany({
    where: {
      status: { in: [OutboxStatus.PENDING, OutboxStatus.FAILED] },
      availableAt: { lte: new Date() },
      attempts: { lt: 10 }
    },
    orderBy: { createdAt: "asc" },
    take: 100
  });
  for (const event of events) {
    await queue.add(event.eventType, { eventId: event.id }, {
      jobId: `${event.id}-${event.attempts}`,
      attempts: 5,
      backoff: { type: "exponential", delay: 1000 },
      removeOnComplete: 1000,
      removeOnFail: 5000
    });
  }
}

const timer = setInterval(() => dispatchOutbox().catch((error) => console.error("outbox dispatch failed", error)), 2000);
dispatchOutbox().catch((error) => console.error("initial outbox dispatch failed", error));
worker.on("failed", (job, error) => console.error("domain event failed", job?.id, error));

async function shutdown() {
  clearInterval(timer);
  await worker.close();
  await queue.close();
  await redis.quit();
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
