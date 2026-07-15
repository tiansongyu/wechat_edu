import { OutboxStatus } from "./generated/prisma/enums";

export const DEFAULT_OUTBOX_PROCESSING_LEASE_MS = 5 * 60 * 1000;

export function outboxProcessingLeaseMs(value = process.env.OUTBOX_PROCESSING_LEASE_MS) {
  const parsed = Number(value || DEFAULT_OUTBOX_PROCESSING_LEASE_MS);
  return Number.isFinite(parsed) && parsed >= 30_000 ? parsed : DEFAULT_OUTBOX_PROCESSING_LEASE_MS;
}

export function outboxLeaseExpiredBefore(now: Date, leaseMs: number) {
  return new Date(now.getTime() - leaseMs);
}

export function buildOutboxClaimWhere(eventId: string, now: Date, leaseMs: number) {
  return {
    id: eventId,
    attempts: { lt: 10 },
    OR: [
      {
        status: { in: [OutboxStatus.PENDING, OutboxStatus.FAILED] },
        availableAt: { lte: now }
      },
      {
        status: OutboxStatus.PROCESSING,
        OR: [
          { claimedAt: null },
          { claimedAt: { lt: outboxLeaseExpiredBefore(now, leaseMs) } }
        ]
      }
    ]
  };
}

export function buildOutboxDispatchWhere(now: Date, leaseMs: number) {
  return {
    attempts: { lt: 10 },
    OR: [
      {
        status: { in: [OutboxStatus.PENDING, OutboxStatus.FAILED] },
        availableAt: { lte: now }
      },
      {
        status: OutboxStatus.PROCESSING,
        OR: [
          { claimedAt: null },
          { claimedAt: { lt: outboxLeaseExpiredBefore(now, leaseMs) } }
        ]
      }
    ]
  };
}

export function outboxQueueJobId(
  event: { id: string; attempts: number; status: OutboxStatus; claimedAt?: Date | null },
  now: Date,
  leaseMs: number
) {
  if (event.status !== OutboxStatus.PROCESSING) return `${event.id}-${event.attempts}-ready`;
  const claimTime = event.claimedAt?.getTime() || 0;
  const reclaimGeneration = Math.max(1, Math.floor((now.getTime() - claimTime) / leaseMs));
  return `${event.id}-${event.attempts}-reclaim-${reclaimGeneration}`;
}
