import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import {
  AccountStatus,
  ApplicationStatus,
  AppointmentStatus,
  AuditStatus,
  ReviewStatus,
  RoleCode
} from "../../generated/prisma/enums";
import { ReviewsService } from "./reviews.service";

const APPOINTMENT_ID = "00000000-0000-4000-8000-000000000010";
const PARENT_ID = "00000000-0000-4000-8000-000000000011";
const TEACHER_ID = "00000000-0000-4000-8000-000000000012";
const OUTSIDER_ID = "00000000-0000-4000-8000-000000000013";
const REVIEW_ID = "00000000-0000-4000-8000-000000000030";

function approvedTeacherAccount(overrides: Record<string, unknown> = {}) {
  return {
    id: TEACHER_ID,
    status: AccountStatus.ACTIVE,
    roles: [{ roleCode: RoleCode.TEACHER }],
    teacherProfile: { auditStatus: AuditStatus.APPROVED },
    ...overrides
  };
}

function appointmentContext(
  status: AppointmentStatus = AppointmentStatus.PENDING,
  applicationStatus: ApplicationStatus = ApplicationStatus.ACCEPTED
) {
  return {
    status,
    job: { ownerId: PARENT_ID },
    application: { teacherId: TEACHER_ID, status: applicationStatus }
  };
}

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
      account: { findUnique: jest.fn().mockResolvedValue(approvedTeacherAccount()) },
      review: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: REVIEW_ID,
            appointmentId: APPOINTMENT_ID,
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
    expect(result.items[0]).not.toHaveProperty("appointmentId");
    expect(prisma.review.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        revieweeRole: RoleCode.TEACHER,
        reviewerRole: RoleCode.PARENT
      })
    }));
    expect(prisma.review.groupBy).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        revieweeRole: RoleCode.TEACHER,
        reviewerRole: RoleCode.PARENT
      })
    }));
  });

  it("does not expose a display average before three published completed reviews", async () => {
    const prisma: any = {
      account: { findUnique: jest.fn().mockResolvedValue(approvedTeacherAccount()) },
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

  it("uses one indistinguishable 404 for unavailable public teacher profiles", async () => {
    const unavailableTargets = [
      null,
      approvedTeacherAccount({ status: AccountStatus.SUSPENDED }),
      approvedTeacherAccount({ roles: [] }),
      approvedTeacherAccount({ teacherProfile: { auditStatus: AuditStatus.PENDING } })
    ];
    const responses: unknown[] = [];

    for (const target of unavailableTargets) {
      const prisma: any = {
        account: { findUnique: jest.fn().mockResolvedValue(target) },
        review: { findMany: jest.fn(), findFirst: jest.fn(), groupBy: jest.fn() }
      };
      const service = new ReviewsService(prisma);
      try {
        await service.listTeacherReviews(TEACHER_ID);
        throw new Error("expected teacher profile lookup to fail");
      } catch (error) {
        expect(error).toBeInstanceOf(NotFoundException);
        responses.push((error as NotFoundException).getResponse());
      }
      expect(prisma.review.findMany).not.toHaveBeenCalled();
      expect(prisma.review.groupBy).not.toHaveBeenCalled();
    }

    expect(responses).toEqual(Array(unavailableTargets.length).fill({
      statusCode: 404,
      code: "REVIEW_PROFILE_NOT_FOUND",
      message: "评价资料不存在"
    }));
  });

  it("isolates received reviews by the current active role and opposite reviewer role", async () => {
    const prisma: any = {
      review: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: REVIEW_ID,
            reviewerId: TEACHER_ID,
            reviewerRole: RoleCode.TEACHER,
            revieweeRole: RoleCode.PARENT,
            rating: 4,
            tags: ["需求清晰"],
            content: "合作安排合理",
            createdAt: new Date("2026-07-16T00:00:00.000Z")
          }
        ]),
        groupBy: jest.fn().mockResolvedValue([{ rating: 4, _count: { _all: 1 } }]),
        findFirst: jest.fn()
      }
    };
    const service = new ReviewsService(prisma);

    const result = await service.listReceivedReviews({
      id: PARENT_ID,
      roles: [RoleCode.PARENT, RoleCode.TEACHER],
      activeRole: RoleCode.PARENT
    });

    expect(result).toMatchObject({ visibility: "SELF_FULL", targetRole: RoleCode.PARENT });
    expect(result.items[0]).not.toHaveProperty("reviewerId");
    expect(prisma.review.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        revieweeId: PARENT_ID,
        revieweeRole: RoleCode.PARENT,
        reviewerRole: RoleCode.TEACHER,
        status: ReviewStatus.PUBLISHED,
        appointment: { status: AppointmentStatus.COMPLETED }
      })
    }));
    expect(prisma.review.groupBy).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        revieweeId: PARENT_ID,
        revieweeRole: RoleCode.PARENT,
        reviewerRole: RoleCode.TEACHER
      })
    }));
  });

  it("rejects received-review reads for a non-participant active role before querying reviews", async () => {
    const prisma: any = {
      review: { findMany: jest.fn(), findFirst: jest.fn(), groupBy: jest.fn() }
    };
    const service = new ReviewsService(prisma);

    await expect(service.listReceivedReviews({
      id: OUTSIDER_ID,
      roles: [RoleCode.ADMIN],
      activeRole: RoleCode.ADMIN
    })).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.review.findMany).not.toHaveBeenCalled();
    expect(prisma.review.groupBy).not.toHaveBeenCalled();
  });

  it("returns the same 404 for a missing appointment and an outsider, even if the known appointment is cancelled", async () => {
    const prisma: any = {
      appointment: {
        findUnique: jest.fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(appointmentContext(AppointmentStatus.CANCELLED, ApplicationStatus.CANCELLED))
      },
      review: { findFirst: jest.fn(), groupBy: jest.fn() }
    };
    const service = new ReviewsService(prisma);
    const responses: unknown[] = [];

    for (let index = 0; index < 2; index += 1) {
      try {
        await service.getCounterpartReputation({
          id: OUTSIDER_ID,
          roles: [RoleCode.PARENT],
          activeRole: RoleCode.PARENT
        }, APPOINTMENT_ID);
        throw new Error("expected appointment lookup to fail");
      } catch (error) {
        expect(error).toBeInstanceOf(NotFoundException);
        responses.push((error as NotFoundException).getResponse());
      }
    }

    expect(responses[0]).toEqual(responses[1]);
    expect(responses[0]).toEqual({
      statusCode: 404,
      code: "APPOINTMENT_NOT_FOUND",
      message: "预约不存在"
    });
    expect(prisma.review.findFirst).not.toHaveBeenCalled();
    expect(prisma.review.groupBy).not.toHaveBeenCalled();
  });

  it("requires the appointment participant's active role before exposing counterpart reputation", async () => {
    const prisma: any = {
      appointment: { findUnique: jest.fn().mockResolvedValue(appointmentContext()) },
      review: { findFirst: jest.fn(), groupBy: jest.fn() }
    };
    const service = new ReviewsService(prisma);

    try {
      await service.getCounterpartReputation({
        id: PARENT_ID,
        roles: [RoleCode.PARENT, RoleCode.TEACHER],
        activeRole: RoleCode.TEACHER
      }, APPOINTMENT_ID);
      throw new Error("expected role check to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).getResponse()).toEqual({
        statusCode: 403,
        code: "ROLE_SWITCH_REQUIRED",
        message: "请切换到该预约对应的身份后查看对方评价",
        requiredRole: RoleCode.PARENT
      });
    }
    expect(prisma.review.groupBy).not.toHaveBeenCalled();
  });

  it("rejects counterpart reputation after cancellation only after recognizing the participant", async () => {
    const prisma: any = {
      appointment: {
        findUnique: jest.fn().mockResolvedValue(
          appointmentContext(AppointmentStatus.CANCELLED, ApplicationStatus.CANCELLED)
        )
      },
      review: { findFirst: jest.fn(), groupBy: jest.fn() }
    };
    const service = new ReviewsService(prisma);

    try {
      await service.getCounterpartReputation({
        id: PARENT_ID,
        roles: [RoleCode.PARENT],
        activeRole: RoleCode.PARENT
      }, APPOINTMENT_ID);
      throw new Error("expected cancelled context to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).getResponse()).toMatchObject({
        statusCode: 403,
        code: "REPUTATION_CONTEXT_UNAVAILABLE"
      });
    }
    expect(prisma.review.groupBy).not.toHaveBeenCalled();
  });

  it("lets a teacher view only parent-role summary plus their own appointment review during a dispute", async () => {
    const prisma: any = {
      appointment: {
        findUnique: jest.fn().mockResolvedValue(appointmentContext(AppointmentStatus.DISPUTED))
      },
      review: {
        groupBy: jest.fn().mockResolvedValue([
          { rating: 5, _count: { _all: 2 } },
          { rating: 4, _count: { _all: 1 } }
        ]),
        findFirst: jest.fn().mockResolvedValue({
          id: REVIEW_ID,
          reviewerId: TEACHER_ID,
          appointmentId: APPOINTMENT_ID,
          reviewerRole: RoleCode.TEACHER,
          revieweeRole: RoleCode.PARENT,
          rating: 4,
          tags: ["需求清晰"],
          content: "合作安排合理",
          status: ReviewStatus.HIDDEN,
          createdAt: new Date("2026-07-16T00:00:00.000Z")
        })
      }
    };
    const service = new ReviewsService(prisma);

    const result = await service.getCounterpartReputation({
      id: TEACHER_ID,
      roles: [RoleCode.TEACHER],
      activeRole: RoleCode.TEACHER
    }, APPOINTMENT_ID);

    expect(result).toMatchObject({
      visibility: "APPOINTMENT_PARTICIPANT_SUMMARY",
      targetRole: RoleCode.PARENT,
      summary: { count: 3, displayAverage: 4.67 },
      myReview: { id: REVIEW_ID, status: ReviewStatus.HIDDEN, rating: 4 }
    });
    expect(result).not.toHaveProperty("items");
    expect(result.myReview).not.toHaveProperty("reviewerId");
    expect(result.myReview).not.toHaveProperty("appointmentId");
    expect(prisma.review.groupBy).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        revieweeId: PARENT_ID,
        revieweeRole: RoleCode.PARENT,
        reviewerRole: RoleCode.TEACHER,
        status: ReviewStatus.PUBLISHED,
        appointment: { status: AppointmentStatus.COMPLETED }
      }
    }));
    expect(prisma.review.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        appointmentId: APPOINTMENT_ID,
        reviewerId: TEACHER_ID,
        revieweeId: PARENT_ID,
        reviewerRole: RoleCode.TEACHER,
        revieweeRole: RoleCode.PARENT
      })
    }));
  });

  it("returns only a teacher-role summary to the parent appointment participant", async () => {
    const prisma: any = {
      appointment: {
        findUnique: jest.fn().mockResolvedValue(appointmentContext(AppointmentStatus.CONFIRMED))
      },
      review: {
        groupBy: jest.fn().mockResolvedValue([{ rating: 5, _count: { _all: 2 } }]),
        findFirst: jest.fn()
      }
    };
    const service = new ReviewsService(prisma);

    const result = await service.getCounterpartReputation({
      id: PARENT_ID,
      roles: [RoleCode.PARENT],
      activeRole: RoleCode.PARENT
    }, APPOINTMENT_ID);

    expect(result).toEqual({
      visibility: "APPOINTMENT_PARTICIPANT_SUMMARY",
      targetRole: RoleCode.TEACHER,
      summary: {
        displayAverage: null,
        count: 2,
        distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 2 },
        level: "NEW",
        levelLabel: "评价积累中",
        algorithmVersion: "review-v1"
      }
    });
    expect(prisma.review.groupBy).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        revieweeId: TEACHER_ID,
        revieweeRole: RoleCode.TEACHER,
        reviewerRole: RoleCode.PARENT
      })
    }));
    expect(prisma.review.findFirst).not.toHaveBeenCalled();
  });

  it("rejects a cursor that does not belong to the same teacher-role review list", async () => {
    const prisma: any = {
      account: { findUnique: jest.fn().mockResolvedValue(approvedTeacherAccount()) },
      review: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn(),
        groupBy: jest.fn()
      }
    };
    const service = new ReviewsService(prisma);

    await expect(service.listTeacherReviews(TEACHER_ID, REVIEW_ID)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.review.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: REVIEW_ID,
        revieweeId: TEACHER_ID,
        revieweeRole: RoleCode.TEACHER,
        reviewerRole: RoleCode.PARENT
      })
    }));
    expect(prisma.review.findMany).not.toHaveBeenCalled();
    expect(prisma.review.groupBy).not.toHaveBeenCalled();
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
