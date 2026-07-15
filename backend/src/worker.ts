import "reflect-metadata";
import { PrismaPg } from "@prisma/adapter-pg";
import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import { PrismaClient } from "./generated/prisma/client";
import { OutboxStatus } from "./generated/prisma/enums";
import { processDomainEventNotifications } from "./domain-event-handler";
import {
  buildOutboxClaimWhere,
  buildOutboxDispatchWhere,
  outboxProcessingLeaseMs,
  outboxQueueJobId
} from "./outbox-lease";

const connectionString = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;
if (!connectionString || !redisUrl) throw new Error("DATABASE_URL and REDIS_URL are required");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const redis = new IORedis(redisUrl, { maxRetriesPerRequest: null });
const queue = new Queue("domain-events", { connection: redis as any });
const processingLeaseMs = outboxProcessingLeaseMs();

const worker = new Worker(
  "domain-events",
  async (job) => {
    const event = await prisma.outboxEvent.findUnique({ where: { id: job.data.eventId } });
    if (!event || event.status === OutboxStatus.PUBLISHED) return;
    const claimedAt = new Date();
    const claimed = await prisma.outboxEvent.updateMany({
      where: buildOutboxClaimWhere(event.id, claimedAt, processingLeaseMs),
      data: { status: OutboxStatus.PROCESSING, claimedAt, attempts: { increment: 1 }, lastError: null }
    });
    if (!claimed.count) return;
    try {
      await processDomainEventNotifications(prisma, event);
      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: { status: OutboxStatus.PUBLISHED, claimedAt: null, processedAt: new Date(), lastError: null }
      });
    } catch (error) {
      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: {
          status: OutboxStatus.FAILED,
          claimedAt: null,
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
  const now = new Date();
  const events = await prisma.outboxEvent.findMany({
    where: buildOutboxDispatchWhere(now, processingLeaseMs),
    orderBy: { createdAt: "asc" },
    take: 100
  });
  for (const event of events) {
    await queue.add(event.eventType, { eventId: event.id }, {
      jobId: outboxQueueJobId(event, now, processingLeaseMs),
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
