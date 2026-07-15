import { createHash } from "node:crypto";
import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import {
  ReviewReportCategory,
  ReviewReportStatus,
  ReviewStatus,
  RoleCode
} from "../../generated/prisma/enums";
import { ReviewGovernanceService } from "./review-governance.service";

const parent = { id: "parent-id", activeRole: RoleCode.PARENT, roles: [RoleCode.PARENT, RoleCode.TEACHER] };
const teacher = { id: "teacher-id", activeRole: RoleCode.TEACHER, roles: [RoleCode.PARENT, RoleCode.TEACHER] };
const now = new Date("2026-07-16T04:00:00.000Z");

const reportRecord = {
  id: "report-id",
  reviewId: "review-id",
  category: ReviewReportCategory.PRIVACY_LEAK,
  description: "评价中包含未经允许公开的隐私信息",
  status: ReviewReportStatus.OPEN,
  resolutionNote: null,
  resolvedAt: null,
  createdAt: now
};

const adminReview = {
  id: "review-id",
  appointmentId: "appointment-id",
  reviewerRole: RoleCode.TEACHER,
  revieweeRole: RoleCode.PARENT,
  rating: 1,
  tags: ["沟通顺畅"],
  content: "一次需要平台复核的合作评价",
  status: ReviewStatus.HIDDEN,
  version: 2,
  statusChangedReason: "复核发现包含隐私信息，需要暂时隐藏",
  statusChangedAt: now,
  createdAt: now,
  reviewer: { id: "teacher-id", nickname: "老师" },
  reviewee: { id: "parent-id", nickname: "家长" }
};

const adminReport = {
  ...reportRecord,
  reporterRole: RoleCode.PARENT,
  status: ReviewReportStatus.ACTION_TAKEN,
  version: 2,
  resolutionNote: "复核确认内容违规，评价已经隐藏处理",
  resolvedAt: now,
  reporter: { id: "parent-id", nickname: "家长" },
  review: {
    rating: 1,
    tags: [],
    content: "一次需要平台复核的合作评价",
    status: ReviewStatus.HIDDEN,
    version: 2,
    revieweeRole: RoleCode.PARENT,
    reviewer: { nickname: "老师" },
    reviewee: { nickname: "家长" }
  }
};

function setup() {
  const prisma: any = {
    review: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      count: jest.fn(),
      updateMany: jest.fn()
    },
    reviewReport: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn()
    },
    idempotencyRecord: {
      findUnique: jest.fn(),
      create: jest.fn(),
      delete: jest.fn()
    },
    auditLog: { create: jest.fn() },
    outboxEvent: { create: jest.fn() },
    $queryRawUnsafe: jest.fn(),
    $transaction: jest.fn()
  };
  prisma.$transaction.mockImplementation((callback: (tx: any) => unknown) => callback(prisma));
  return { prisma, service: new ReviewGovernanceService(prisma) };
}

function reportHash(activeRole: RoleCode, category: ReviewReportCategory, description: string) {
  return createHash("sha256")
    .update(JSON.stringify({ activeRole, category, description }))
    .digest("hex");
}

describe("ReviewGovernanceService user report boundary", () => {
  it.each([
    ["outsider", parent],
    ["wrong active role", teacher]
  ])("returns the same not-found boundary for a missing or inaccessible review: %s", async (_label, user) => {
    const { prisma, service } = setup();
    prisma.review.findFirst.mockResolvedValue(null);

    await expect(service.createReport(user, "review-id", "request-key", {
      category: ReviewReportCategory.HARASSMENT,
      description: "这是一段长度足够的举报情况详细说明"
    })).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.idempotencyRecord.findUnique).toHaveBeenCalledTimes(1);
    expect(prisma.review.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        revieweeId: user.id,
        revieweeRole: user.activeRole,
        status: { not: ReviewStatus.REMOVED }
      })
    }));
  });

  it("creates one OPEN report with audit, outbox and an idempotency record", async () => {
    const { prisma, service } = setup();
    prisma.review.findFirst.mockResolvedValue({ id: "review-id" });
    prisma.idempotencyRecord.findUnique.mockResolvedValue(null);
    prisma.reviewReport.findUnique.mockResolvedValue(null);
    prisma.reviewReport.create.mockResolvedValue(reportRecord);
    prisma.auditLog.create.mockResolvedValue({});
    prisma.outboxEvent.create.mockResolvedValue({});
    prisma.idempotencyRecord.create.mockResolvedValue({});

    await expect(service.createReport(parent, "review-id", " request-key ", {
      category: ReviewReportCategory.PRIVACY_LEAK,
      description: "  评价中包含未经允许公开的隐私信息  "
    })).resolves.toEqual({
      id: "report-id",
      reviewId: "review-id",
      category: ReviewReportCategory.PRIVACY_LEAK,
      status: ReviewReportStatus.OPEN,
      description: "评价中包含未经允许公开的隐私信息",
      createdAt: now.toISOString()
    });
    expect(prisma.reviewReport.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        reporterId: parent.id,
        reporterRole: RoleCode.PARENT,
        status: ReviewReportStatus.OPEN
      })
    }));
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.outboxEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ eventType: "review.reported" })
    }));
    expect(prisma.idempotencyRecord.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ scope: "review-report:review-id", key: "request-key" })
    }));
  });

  it("returns the cached result before rechecking a review that may now be removed", async () => {
    const { prisma, service } = setup();
    const description = "评价中包含未经允许公开的隐私信息";
    const cached = { ok: true };
    prisma.review.findFirst.mockResolvedValue(null);
    prisma.idempotencyRecord.findUnique.mockResolvedValue({
      expiresAt: new Date(Date.now() + 60_000),
      requestHash: reportHash(RoleCode.PARENT, ReviewReportCategory.PRIVACY_LEAK, description),
      response: cached
    });

    await expect(service.createReport(parent, "review-id", "request-key", {
      category: ReviewReportCategory.PRIVACY_LEAK,
      description: ` ${description} `
    })).resolves.toBe(cached);
    expect(prisma.review.findFirst).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects reuse of an idempotency key with different content", async () => {
    const { prisma, service } = setup();
    prisma.review.findFirst.mockResolvedValue({ id: "review-id" });
    prisma.idempotencyRecord.findUnique.mockResolvedValue({
      expiresAt: new Date(Date.now() + 60_000),
      requestHash: "another-request-hash",
      response: { ok: true }
    });

    await expect(service.createReport(parent, "review-id", "request-key", {
      category: ReviewReportCategory.ADVERTISING,
      description: "评价内容存在明显的广告导流联系方式"
    })).rejects.toBeInstanceOf(ConflictException);
  });

  it("enforces one report for each review and reporter even with a fresh key", async () => {
    const { prisma, service } = setup();
    prisma.review.findFirst.mockResolvedValue({ id: "review-id" });
    prisma.idempotencyRecord.findUnique.mockResolvedValue(null);
    prisma.reviewReport.findUnique.mockResolvedValue({ id: "existing-report" });

    await expect(service.createReport(parent, "review-id", "new-key", {
      category: ReviewReportCategory.FALSE_INFORMATION,
      description: "评价内容与本次实际合作情况明显不一致"
    })).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.reviewReport.create).not.toHaveBeenCalled();
  });

  it.each(["太短", " ".repeat(20)])("rejects an invalid trimmed description: %s", async (description) => {
    const { service } = setup();
    await expect(service.createReport(parent, "review-id", "request-key", {
      category: ReviewReportCategory.OTHER,
      description
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it("lists only reports submitted under the current active role without sensitive actor IDs", async () => {
    const { prisma, service } = setup();
    prisma.reviewReport.findMany.mockResolvedValue([reportRecord]);

    const result = await service.listMyReports(parent, undefined, 20);
    expect(prisma.reviewReport.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { reporterId: parent.id, reporterRole: RoleCode.PARENT }
    }));
    expect(result).toEqual({
      items: [{
        id: "report-id",
        reviewId: "review-id",
        category: ReviewReportCategory.PRIVACY_LEAK,
        description: reportRecord.description,
        status: ReviewReportStatus.OPEN,
        resolutionNote: null,
        resolvedAt: null,
        createdAt: now.toISOString()
      }],
      nextCursor: null
    });
    expect(JSON.stringify(result)).not.toMatch(/reporterId|resolvedBy|resolver/);
  });

  it("rejects a cursor owned by another role or account", async () => {
    const { prisma, service } = setup();
    prisma.reviewReport.findFirst.mockResolvedValue(null);
    await expect(service.listMyReports(parent, "other-cursor", 20)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.reviewReport.findMany).not.toHaveBeenCalled();
  });
});

describe("ReviewGovernanceService admin moderation", () => {
  it("uses a finite review projection that excludes contact and address fields", async () => {
    const { prisma, service } = setup();
    prisma.review.findMany.mockResolvedValue([adminReview]);
    prisma.review.count.mockResolvedValue(1);

    await expect(service.listAdminReviews({ page: 1, pageSize: 20 })).resolves.toEqual({
      items: [adminReview], total: 1, page: 1, pageSize: 20
    });
    const select = prisma.review.findMany.mock.calls[0][0].select;
    expect(JSON.stringify(select)).not.toMatch(/phone|address|openid|unionid|password|contact/i);
  });

  it("hides a review using an optimistic lock without mutating rating content", async () => {
    const { prisma, service } = setup();
    prisma.review.findUnique.mockResolvedValue({
      id: "review-id", status: ReviewStatus.PUBLISHED, version: 1,
      statusChangedReason: null, statusChangedAt: null
    });
    prisma.review.updateMany.mockResolvedValue({ count: 1 });
    prisma.review.findUniqueOrThrow.mockResolvedValue(adminReview);
    prisma.auditLog.create.mockResolvedValue({});
    prisma.outboxEvent.create.mockResolvedValue({});

    await expect(service.hideReview("admin-id", "review-id", {
      reason: "评价疑似泄露用户隐私，需要暂时隐藏复核",
      version: 1
    })).resolves.toBe(adminReview);
    const update = prisma.review.updateMany.mock.calls[0][0];
    expect(update.where).toEqual({ id: "review-id", status: ReviewStatus.PUBLISHED, version: 1 });
    expect(update.data).toMatchObject({
      status: ReviewStatus.HIDDEN,
      version: { increment: 1 },
      statusChangedById: "admin-id"
    });
    expect(update.data).not.toHaveProperty("rating");
    expect(update.data).not.toHaveProperty("tags");
    expect(update.data).not.toHaveProperty("content");
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.outboxEvent.create).toHaveBeenCalledTimes(1);
  });

  it("restores only a hidden review and records the reason", async () => {
    const { prisma, service } = setup();
    prisma.review.findUnique.mockResolvedValue({
      id: "review-id", status: ReviewStatus.HIDDEN, version: 2,
      statusChangedReason: "原隐藏原因", statusChangedAt: now
    });
    prisma.review.updateMany.mockResolvedValue({ count: 1 });
    prisma.review.findUniqueOrThrow.mockResolvedValue({ ...adminReview, status: ReviewStatus.PUBLISHED, version: 3 });
    prisma.auditLog.create.mockResolvedValue({});
    prisma.outboxEvent.create.mockResolvedValue({});

    await service.restoreReview("admin-id", "review-id", {
      reason: "复核确认评价未违反规则，现在恢复公开展示",
      version: 2
    });
    expect(prisma.review.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "review-id", status: ReviewStatus.HIDDEN, version: 2 },
      data: expect.objectContaining({ status: ReviewStatus.PUBLISHED, version: { increment: 1 } })
    }));
  });

  it("rejects stale review versions before a state update", async () => {
    const { prisma, service } = setup();
    prisma.review.findUnique.mockResolvedValue({
      id: "review-id", status: ReviewStatus.PUBLISHED, version: 3,
      statusChangedReason: null, statusChangedAt: null
    });

    await expect(service.hideReview("admin-id", "review-id", {
      reason: "评价需要隐藏以便平台进一步调查处理",
      version: 2
    })).rejects.toMatchObject({ response: expect.objectContaining({ code: "VERSION_CONFLICT", currentVersion: 3 }) });
    expect(prisma.review.updateMany).not.toHaveBeenCalled();
  });

  it("rejects an invalid state transition rather than silently succeeding", async () => {
    const { prisma, service } = setup();
    prisma.review.findUnique.mockResolvedValue({
      id: "review-id", status: ReviewStatus.HIDDEN, version: 2,
      statusChangedReason: null, statusChangedAt: null
    });
    await expect(service.hideReview("admin-id", "review-id", {
      reason: "评价需要隐藏以便平台进一步调查处理",
      version: 2
    })).rejects.toBeInstanceOf(ConflictException);
  });

  it("resolves ACTION_TAKEN and hides a published review in the same transaction", async () => {
    const { prisma, service } = setup();
    prisma.reviewReport.findUnique.mockResolvedValue({
      id: "report-id",
      reviewId: "review-id",
      status: ReviewReportStatus.OPEN,
      version: 1,
      category: ReviewReportCategory.PRIVACY_LEAK,
      review: { id: "review-id", status: ReviewStatus.PUBLISHED, version: 1 }
    });
    prisma.review.findUnique.mockResolvedValue({ id: "review-id", status: ReviewStatus.PUBLISHED, version: 1 });
    prisma.review.updateMany.mockResolvedValue({ count: 1 });
    prisma.reviewReport.updateMany.mockResolvedValue({ count: 1 });
    prisma.reviewReport.findUniqueOrThrow.mockResolvedValue(adminReport);
    prisma.auditLog.create.mockResolvedValue({});
    prisma.outboxEvent.create.mockResolvedValue({});

    await expect(service.resolveReport("admin-id", "report-id", {
      resolution: ReviewReportStatus.ACTION_TAKEN,
      note: "复核确认内容违规，评价已经隐藏处理",
      version: 1,
      reviewVersion: 1
    })).resolves.toBe(adminReport);
    expect(prisma.review.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "review-id", version: 1, status: ReviewStatus.PUBLISHED },
      data: expect.objectContaining({ status: ReviewStatus.HIDDEN, statusChangedById: "admin-id" })
    }));
    expect(prisma.reviewReport.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "report-id", version: 1, status: ReviewReportStatus.OPEN },
      data: expect.objectContaining({
        status: ReviewReportStatus.ACTION_TAKEN,
        resolvedById: "admin-id",
        version: { increment: 1 }
      })
    }));
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(2);
    expect(prisma.outboxEvent.create).toHaveBeenCalledTimes(2);
  });

  it("resolves NO_VIOLATION without modifying the review", async () => {
    const { prisma, service } = setup();
    prisma.reviewReport.findUnique.mockResolvedValue({
      id: "report-id", reviewId: "review-id", status: ReviewReportStatus.OPEN, version: 1,
      category: ReviewReportCategory.OTHER,
      review: { id: "review-id", status: ReviewStatus.PUBLISHED, version: 4 }
    });
    prisma.review.findUnique.mockResolvedValue({ id: "review-id", status: ReviewStatus.PUBLISHED, version: 4 });
    prisma.reviewReport.updateMany.mockResolvedValue({ count: 1 });
    prisma.reviewReport.findUniqueOrThrow.mockResolvedValue({ ...adminReport, status: ReviewReportStatus.NO_VIOLATION });
    prisma.auditLog.create.mockResolvedValue({});
    prisma.outboxEvent.create.mockResolvedValue({});

    await service.resolveReport("admin-id", "report-id", {
      resolution: ReviewReportStatus.NO_VIOLATION,
      note: "复核后未发现违反平台评价规则的内容",
      version: 1,
      reviewVersion: 4
    });
    expect(prisma.review.updateMany).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.outboxEvent.create).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["report", 2, 1],
    ["review", 1, 8]
  ])("rejects a stale %s version when resolving", async (target, version, reviewVersion) => {
    const { prisma, service } = setup();
    prisma.reviewReport.findUnique.mockResolvedValue({
      id: "report-id", reviewId: "review-id", status: ReviewReportStatus.OPEN, version: 1,
      category: ReviewReportCategory.OTHER,
      review: { id: "review-id", status: ReviewStatus.PUBLISHED, version: 4 }
    });
    prisma.review.findUnique.mockResolvedValue({ id: "review-id", status: ReviewStatus.PUBLISHED, version: 4 });
    await expect(service.resolveReport("admin-id", "report-id", {
      resolution: ReviewReportStatus.NO_VIOLATION,
      note: "复核后未发现违反平台评价规则的内容",
      version,
      reviewVersion
    })).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.reviewReport.updateMany).not.toHaveBeenCalled();
  });

  it("lists report governance fields with a finite nested projection", async () => {
    const { prisma, service } = setup();
    prisma.reviewReport.findMany.mockResolvedValue([adminReport]);
    prisma.reviewReport.count.mockResolvedValue(1);
    await expect(service.listAdminReports({ page: 1, pageSize: 20 })).resolves.toEqual({
      items: [adminReport], total: 1, page: 1, pageSize: 20
    });
    const select = prisma.reviewReport.findMany.mock.calls[0][0].select;
    expect(JSON.stringify(select)).not.toMatch(/phone|address|openid|unionid|password|contact|resolvedById/i);
  });
});
