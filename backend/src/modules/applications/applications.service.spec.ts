import { BadRequestException, ForbiddenException } from "@nestjs/common";
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
    const prisma = {
      idempotencyRecord: {
        findUnique: jest.fn().mockResolvedValue({
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
});
