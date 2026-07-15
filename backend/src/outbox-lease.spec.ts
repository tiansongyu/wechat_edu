import { OutboxStatus } from "./generated/prisma/enums";
import {
  buildOutboxClaimWhere,
  buildOutboxDispatchWhere,
  DEFAULT_OUTBOX_PROCESSING_LEASE_MS,
  outboxProcessingLeaseMs,
  outboxQueueJobId
} from "./outbox-lease";

describe("outbox processing lease", () => {
  const now = new Date("2026-07-16T12:00:00.000Z");

  it("allows a worker to reclaim only a stale PROCESSING event", () => {
    const where = buildOutboxClaimWhere("event-1", now, 60_000);

    expect(where).toMatchObject({ id: "event-1", attempts: { lt: 10 } });
    expect(where.OR[1]).toEqual({
      status: OutboxStatus.PROCESSING,
      OR: [
        { claimedAt: null },
        { claimedAt: { lt: new Date("2026-07-16T11:59:00.000Z") } }
      ]
    });
  });

  it("dispatches ready events and expired processing leases", () => {
    const where = buildOutboxDispatchWhere(now, 60_000);

    expect(where.OR[0]).toMatchObject({
      status: { in: [OutboxStatus.PENDING, OutboxStatus.FAILED] },
      availableAt: { lte: now }
    });
    expect(where.OR[1]).toMatchObject({ status: OutboxStatus.PROCESSING });
  });

  it("uses a bounded default lease and a new queue id for reclaim work", () => {
    expect(outboxProcessingLeaseMs("1000")).toBe(DEFAULT_OUTBOX_PROCESSING_LEASE_MS);
    expect(outboxProcessingLeaseMs("60000")).toBe(60_000);
    expect(outboxQueueJobId(
      {
        id: "event-1",
        attempts: 2,
        status: OutboxStatus.PROCESSING,
        claimedAt: new Date("2026-07-16T11:57:30.000Z")
      },
      now,
      60_000
    )).toBe("event-1-2-reclaim-2");
  });
});
