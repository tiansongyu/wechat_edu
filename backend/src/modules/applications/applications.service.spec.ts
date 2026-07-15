import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import { createHash } from "crypto";
import { ApplicationsService } from "./applications.service";

describe("ApplicationsService", () => {
  it("rejects a request without an idempotency key before touching the database", async () => {
    const prisma = { idempotencyRecord: { findUnique: jest.fn() } };
    const service = new ApplicationsService(prisma as never);

    await expect(service.apply(
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000002",
      "",
      { coverLetter: "" }
    )).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.idempotencyRecord.findUnique).not.toHaveBeenCalled();
  });

  it("returns a still-valid idempotent response without creating another application", async () => {
    const cachedResponse = { id: "cached-application", status: "PENDING" };
    const requestHash = createHash("sha256")
      .update(JSON.stringify({ command: "apply", coverLetter: "" }))
      .digest("hex");
    const prisma = {
      idempotencyRecord: {
        findUnique: jest.fn().mockResolvedValue({
          requestHash,
          response: cachedResponse,
          expiresAt: new Date(Date.now() + 60_000)
        })
      },
      $transaction: jest.fn()
    };
    const service = new ApplicationsService(prisma as never);

    await expect(service.apply(
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000002",
      "device-request-key",
      { coverLetter: "" }
    )).resolves.toEqual(cachedResponse);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects a legacy apply record without a request hash", async () => {
    const prisma = {
      idempotencyRecord: {
        findUnique: jest.fn().mockResolvedValue({
          requestHash: null,
          response: { id: "legacy-application" },
          expiresAt: new Date(Date.now() + 60_000)
        })
      },
      $transaction: jest.fn()
    };
    const service = new ApplicationsService(prisma as never);

    await expect(service.apply(
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000002",
      "legacy-key-without-hash",
      { coverLetter: "" }
    )).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects an apply key reused with a different normalized cover letter", async () => {
    const storedHash = createHash("sha256")
      .update(JSON.stringify({ command: "apply", coverLetter: "第一次申请说明" }))
      .digest("hex");
    const prisma = {
      idempotencyRecord: {
        findUnique: jest.fn().mockResolvedValue({
          requestHash: storedHash,
          response: { id: "cached-application" },
          expiresAt: new Date(Date.now() + 60_000)
        })
      },
      $transaction: jest.fn()
    };
    const service = new ApplicationsService(prisma as never);

    await expect(service.apply(
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000002",
      "same-apply-key",
      { coverLetter: "第二次不同说明" }
    )).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("blocks an unapproved teacher inside the serializable transaction", async () => {
    const transaction = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([]),
      idempotencyRecord: {
        findUnique: jest.fn().mockResolvedValue(null),
        delete: jest.fn()
      },
      jobPost: {
        findUnique: jest.fn().mockResolvedValue({
          id: "00000000-0000-4000-8000-000000000002",
          ownerId: "00000000-0000-4000-8000-000000000003",
          type: "TEACHING_NEED",
          status: "PUBLISHED"
        })
      },
      teacherProfile: { findUnique: jest.fn().mockResolvedValue({ auditStatus: "PENDING" }) },
      application: { findUnique: jest.fn().mockResolvedValue(null) }
    };
    const prisma = {
      idempotencyRecord: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(async (operation: (tx: typeof transaction) => unknown) => operation(transaction))
    };
    const service = new ApplicationsService(prisma as never);

    await expect(service.apply(
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000002",
      "device-request-key",
      { coverLetter: "" }
    )).rejects.toBeInstanceOf(ForbiddenException);
    expect(transaction.application.findUnique).toHaveBeenCalledTimes(1);
  });

  it("stores accept, audit, outbox and the idempotent response in one transaction", async () => {
    const ownerId = "00000000-0000-4000-8000-000000000003";
    const applicationId = "00000000-0000-4000-8000-000000000004";
    const jobId = "00000000-0000-4000-8000-000000000002";
    const application = {
      id: applicationId,
      jobId,
      teacherId: "00000000-0000-4000-8000-000000000005",
      status: "PENDING",
      statusNote: null,
      version: 1,
      job: { id: jobId, ownerId, status: "PUBLISHED", capacity: 2 }
    };
    const updated = { ...application, status: "ACCEPTED", statusNote: "欢迎加入", version: 2 };
    const tx = {
      $queryRawUnsafe: jest.fn()
        .mockResolvedValueOnce([{ jobId }])
        .mockResolvedValueOnce([{ id: jobId }]),
      application: {
        findUnique: jest.fn().mockResolvedValue(application),
        count: jest.fn().mockResolvedValue(0),
        update: jest.fn().mockResolvedValue(updated)
      },
      appointment: { create: jest.fn().mockResolvedValue({}) },
      jobPost: { update: jest.fn() },
      outboxEvent: { create: jest.fn().mockResolvedValue({}) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      idempotencyRecord: {
        findUnique: jest.fn().mockResolvedValue(null),
        delete: jest.fn(),
        create: jest.fn().mockResolvedValue({})
      }
    };
    const prisma = {
      $transaction: jest.fn((callback: (transaction: typeof tx) => unknown) => callback(tx))
    };
    const service = new ApplicationsService(prisma as never);

    await expect(service.accept(ownerId, applicationId, "  欢迎加入  ", "accept-command-key"))
      .resolves.toEqual(updated);
    expect(tx.application.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ statusNote: "欢迎加入" })
    }));
    expect(tx.outboxEvent.create).toHaveBeenCalledTimes(1);
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
    expect(tx.idempotencyRecord.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ key: "accept-command-key", requestHash: expect.any(String) })
    }));
  });

  it("returns a cached response for the same normalized application command", async () => {
    const ownerId = "00000000-0000-4000-8000-000000000003";
    const applicationId = "00000000-0000-4000-8000-000000000004";
    const jobId = "00000000-0000-4000-8000-000000000002";
    const cachedResponse = { id: applicationId, status: "ACCEPTED", version: 2 };
    const requestHash = createHash("sha256")
      .update(JSON.stringify({ command: "accept", note: "欢迎加入" }))
      .digest("hex");
    const tx = {
      $queryRawUnsafe: jest.fn()
        .mockResolvedValueOnce([{ jobId }])
        .mockResolvedValueOnce([{ id: jobId }]),
      application: {
        findUnique: jest.fn().mockResolvedValue({
          id: applicationId,
          jobId,
          status: "ACCEPTED",
          job: { ownerId, status: "CLOSED", capacity: 1 }
        }),
        update: jest.fn(),
        count: jest.fn()
      },
      idempotencyRecord: {
        findUnique: jest.fn().mockResolvedValue({
          id: "cached-command",
          requestHash,
          response: cachedResponse,
          expiresAt: new Date(Date.now() + 60_000)
        }),
        delete: jest.fn(),
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn((callback: (transaction: typeof tx) => unknown) => callback(tx))
    };
    const service = new ApplicationsService(prisma as never);

    await expect(service.accept(ownerId, applicationId, " 欢迎加入 ", "same-command-key"))
      .resolves.toEqual(cachedResponse);
    expect(tx.application.update).not.toHaveBeenCalled();
    expect(tx.idempotencyRecord.create).not.toHaveBeenCalled();
  });

  it("rejects reusing an application command key with different content", async () => {
    const ownerId = "00000000-0000-4000-8000-000000000003";
    const applicationId = "00000000-0000-4000-8000-000000000004";
    const jobId = "00000000-0000-4000-8000-000000000002";
    const tx = {
      $queryRawUnsafe: jest.fn()
        .mockResolvedValueOnce([{ jobId }])
        .mockResolvedValueOnce([{ id: jobId }]),
      application: {
        findUnique: jest.fn().mockResolvedValue({
          id: applicationId,
          jobId,
          status: "ACCEPTED",
          job: { ownerId, status: "CLOSED", capacity: 1 }
        }),
        update: jest.fn()
      },
      idempotencyRecord: {
        findUnique: jest.fn().mockResolvedValue({
          id: "cached-command",
          requestHash: "different-command-hash",
          response: { id: applicationId },
          expiresAt: new Date(Date.now() + 60_000)
        }),
        delete: jest.fn(),
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn((callback: (transaction: typeof tx) => unknown) => callback(tx))
    };
    const service = new ApplicationsService(prisma as never);

    await expect(service.accept(ownerId, applicationId, "另一个备注", "same-command-key"))
      .rejects.toBeInstanceOf(ConflictException);
    expect(tx.application.update).not.toHaveBeenCalled();
  });
});
