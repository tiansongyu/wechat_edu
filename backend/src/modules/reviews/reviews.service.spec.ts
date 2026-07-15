import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import { AppointmentStatus, RoleCode } from "../../generated/prisma/enums";
import { ReviewsService } from "./reviews.service";

const APPOINTMENT_ID = "00000000-0000-4000-8000-000000000010";
const PARENT_ID = "00000000-0000-4000-8000-000000000011";
const TEACHER_ID = "00000000-0000-4000-8000-000000000012";
const OUTSIDER_ID = "00000000-0000-4000-8000-000000000013";

function appointment(status: AppointmentStatus = AppointmentStatus.COMPLETED) {
  return {
    id: APPOINTMENT_ID,
    status,
    parentCompletedAt: status === AppointmentStatus.COMPLETED ? new Date("2026-07-16T00:00:00.000Z") : null,
    teacherCompletedAt: status === AppointmentStatus.COMPLETED ? new Date("2026-07-16T00:01:00.000Z") : null,
    completedAt: status === AppointmentStatus.COMPLETED ? new Date("2026-07-16T00:01:00.000Z") : null,
    job: { id: "00000000-0000-4000-8000-000000000020", ownerId: PARENT_ID },
    application: { id: "00000000-0000-4000-8000-000000000021", teacherId: TEACHER_ID, status: "ACCEPTED" }
  };
}

function transaction(overrides: Record<string, unknown> = {}) {
  const tx: any = {
    $queryRawUnsafe: jest.fn().mockResolvedValue([{ id: APPOINTMENT_ID }]),
    idempotencyRecord: {
      findUnique: jest.fn().mockResolvedValue(null),
      delete: jest.fn().mockResolvedValue({}),
      create: jest.fn().mockResolvedValue({})
    },
    appointment: { findUnique: jest.fn().mockResolvedValue(appointment()) },
    review: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({
        id: "00000000-0000-4000-8000-000000000030",
        ...data,
        createdAt: new Date("2026-07-16T00:00:00.000Z"),
        updatedAt: new Date("2026-07-16T00:00:00.000Z")
      }))
    },
    outboxEvent: { create: jest.fn().mockResolvedValue({}) },
    auditLog: { create: jest.fn().mockResolvedValue({}) }
  };
  for (const [key, value] of Object.entries(overrides)) tx[key] = value;
  return tx;
}

function serviceWith(tx: any) {
  const prisma: any = {
    idempotencyRecord: { findUnique: jest.fn().mockResolvedValue(null) },
    $transaction: jest.fn((callback) => callback(tx))
  };
  return { service: new ReviewsService(prisma), prisma };
}

describe("ReviewsService", () => {
  it("rejects an account that is not one of the appointment parties", async () => {
    const tx = transaction();
    const { service } = serviceWith(tx);

    await expect(service.create(
      { id: OUTSIDER_ID, roles: [RoleCode.PARENT], activeRole: RoleCode.PARENT },
      APPOINTMENT_ID,
      "outsider-review",
      { rating: 5, tags: ["沟通顺畅"], content: "" }
    )).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.review.create).not.toHaveBeenCalled();
  });

  it("rejects a review before the appointment is completed", async () => {
    const tx = transaction({
      appointment: { findUnique: jest.fn().mockResolvedValue(appointment(AppointmentStatus.CONFIRMED)) }
    });
    const { service } = serviceWith(tx);

    await expect(service.create(
      { id: PARENT_ID, roles: [RoleCode.PARENT], activeRole: RoleCode.PARENT },
      APPOINTMENT_ID,
      "early-review",
      { rating: 5, tags: ["专业耐心"] }
    )).rejects.toBeInstanceOf(ConflictException);
    expect(tx.review.create).not.toHaveBeenCalled();
  });

  it("does not grant review eligibility to legacy completed rows without two acknowledgements", async () => {
    const legacyCompleted = {
      ...appointment(AppointmentStatus.COMPLETED),
      parentCompletedAt: null,
      teacherCompletedAt: null,
      completedAt: null
    };
    const tx = transaction({
      appointment: { findUnique: jest.fn().mockResolvedValue(legacyCompleted) }
    });
    const { service } = serviceWith(tx);

    await expect(service.create(
      { id: PARENT_ID, roles: [RoleCode.PARENT], activeRole: RoleCode.PARENT },
      APPOINTMENT_ID,
      "legacy-completed-review",
      { rating: 5, tags: ["专业耐心"] }
    )).rejects.toBeInstanceOf(ConflictException);
    expect(tx.review.create).not.toHaveBeenCalled();
  });

  it("requires the relationship's active role even when the account is a participant", async () => {
    const tx = transaction();
    const { service } = serviceWith(tx);

    await expect(service.create(
      { id: PARENT_ID, roles: [RoleCode.PARENT, RoleCode.TEACHER], activeRole: RoleCode.TEACHER },
      APPOINTMENT_ID,
      "wrong-role-review",
      { rating: 5 }
    )).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.review.create).not.toHaveBeenCalled();
  });

  it("rejects a second review by the same reviewer for the appointment", async () => {
    const tx = transaction();
    tx.review.findUnique.mockResolvedValue({ id: "existing-review" });
    const { service } = serviceWith(tx);

    await expect(service.create(
      { id: PARENT_ID, roles: [RoleCode.PARENT], activeRole: RoleCode.PARENT },
      APPOINTMENT_ID,
      "second-review",
      { rating: 4, tags: ["表达清楚"] }
    )).rejects.toBeInstanceOf(ConflictException);
    expect(tx.review.create).not.toHaveBeenCalled();
  });

  it("requires a meaningful explanation for a one or two star review", async () => {
    const tx = transaction();
    const { service, prisma } = serviceWith(tx);

    await expect(service.create(
      { id: PARENT_ID, roles: [RoleCode.PARENT], activeRole: RoleCode.PARENT },
      APPOINTMENT_ID,
      "low-rating",
      { rating: 2, content: "不太满意" }
    )).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects reuse of an idempotency key with a different normalized payload", async () => {
    const prisma: any = {
      idempotencyRecord: {
        findUnique: jest.fn().mockResolvedValue({
          requestHash: "0".repeat(64),
          response: { reviewerRole: RoleCode.PARENT, rating: 5 },
          expiresAt: new Date(Date.now() + 60_000)
        })
      },
      $transaction: jest.fn()
    };
    const service = new ReviewsService(prisma);

    await expect(service.create(
      { id: PARENT_ID, roles: [RoleCode.PARENT], activeRole: RoleCode.PARENT },
      APPOINTMENT_ID,
      "reused-key",
      { rating: 4, tags: ["表达清楚"] }
    )).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("writes the review, outbox event, audit log and idempotency hash atomically", async () => {
    const tx = transaction();
    const { service } = serviceWith(tx);

    const result = await service.create(
      { id: PARENT_ID, roles: [RoleCode.PARENT], activeRole: RoleCode.PARENT },
      APPOINTMENT_ID,
      "create-review",
      { rating: 5, tags: ["专业耐心", "专业耐心", "准时守约"], content: "讲解认真，孩子很喜欢" }
    );

    expect(result).toMatchObject({ rating: 5, reviewerRole: RoleCode.PARENT, revieweeRole: RoleCode.TEACHER });
    expect(tx.review.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ reviewerId: PARENT_ID, revieweeId: TEACHER_ID, tags: ["专业耐心", "准时守约"] })
    }));
    expect(tx.outboxEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ eventType: "review.created" })
    }));
    expect(tx.auditLog.create).toHaveBeenCalled();
    expect(tx.idempotencyRecord.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ requestHash: expect.stringMatching(/^[a-f0-9]{64}$/) })
    }));
  });

  it("returns anonymous public items and a thresholded aggregate summary", async () => {
    const prisma: any = {
      account: { findUnique: jest.fn().mockResolvedValue({ id: TEACHER_ID }) },
      review: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "review-1",
            reviewerId: PARENT_ID,
            reviewerRole: RoleCode.PARENT,
            revieweeRole: RoleCode.TEACHER,
            rating: 5,
            tags: ["专业耐心"],
            content: "讲解清晰",
            createdAt: new Date("2026-07-16T00:00:00.000Z")
          }
        ]),
        groupBy: jest.fn().mockResolvedValue([
          { rating: 5, _count: { _all: 2 } },
          { rating: 4, _count: { _all: 1 } }
        ])
      }
    };
    const service = new ReviewsService(prisma);

    const result = await service.listForAccount(TEACHER_ID, RoleCode.TEACHER);

    expect(result.summary).toEqual({
      displayAverage: 4.67,
      count: 3,
      distribution: { 1: 0, 2: 0, 3: 0, 4: 1, 5: 2 },
      level: "VERY_GOOD",
      levelLabel: "优秀",
      algorithmVersion: "review-v1"
    });
    expect(result.items[0]).toMatchObject({ reviewerLabel: "本次合作家长", rating: 5 });
    expect(result.items[0]).not.toHaveProperty("reviewerId");
    expect(result.items[0]).not.toHaveProperty("nickname");
    expect(prisma.review.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ revieweeRole: RoleCode.TEACHER })
    }));
    expect(prisma.review.groupBy).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ revieweeRole: RoleCode.TEACHER })
    }));
  });

  it("does not expose a display average before three published completed reviews", async () => {
    const prisma: any = {
      account: { findUnique: jest.fn().mockResolvedValue({ id: TEACHER_ID }) },
      review: {
        findMany: jest.fn().mockResolvedValue([]),
        groupBy: jest.fn().mockResolvedValue([{ rating: 5, _count: { _all: 2 } }])
      }
    };
    const service = new ReviewsService(prisma);

    const result = await service.listForAccount(TEACHER_ID, RoleCode.TEACHER);

    expect(result.summary).toMatchObject({ displayAverage: null, count: 2, level: "NEW" });
    expect(result.summary).not.toHaveProperty("average");
  });

  it("does not expose a public parent review page", async () => {
    const prisma: any = { account: { findUnique: jest.fn() }, review: {} };
    const service = new ReviewsService(prisma);

    await expect(service.listForAccount(PARENT_ID, RoleCode.PARENT)).rejects.toThrow("评价记录不存在");
    expect(prisma.account.findUnique).not.toHaveBeenCalled();
  });

  it("requires callers to choose the public teacher review role explicitly", async () => {
    const prisma: any = { account: { findUnique: jest.fn() }, review: {} };
    const service = new ReviewsService(prisma);

    await expect(service.listForAccount(TEACHER_ID, undefined)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.account.findUnique).not.toHaveBeenCalled();
  });

  it("filters contact details before touching the database", async () => {
    const tx = transaction();
    const { service, prisma } = serviceWith(tx);

    await expect(service.create(
      { id: PARENT_ID, roles: [RoleCode.PARENT], activeRole: RoleCode.PARENT },
      APPOINTMENT_ID,
      "private-review",
      { rating: 5, content: "老师电话是 13800138000" }
    )).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("filters deliberately separated Chinese-digit phone numbers", async () => {
    const tx = transaction();
    const { service, prisma } = serviceWith(tx);

    await expect(service.create(
      { id: PARENT_ID, roles: [RoleCode.PARENT], activeRole: RoleCode.PARENT },
      APPOINTMENT_ID,
      "obfuscated-private-review",
      { rating: 5, content: "可以联系一 三 八 · 零 零 一 三 八 零 零 零" }
    )).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
