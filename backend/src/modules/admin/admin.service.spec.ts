import { ConflictException } from "@nestjs/common";
import { ApplicationStatus, AppointmentStatus } from "../../generated/prisma/enums";
import { AdminService } from "./admin.service";

const ADMIN_ID = "00000000-0000-4000-8000-000000000001";
const APPOINTMENT_ID = "00000000-0000-4000-8000-000000000002";

function appointment(status: AppointmentStatus, overrides: Record<string, unknown> = {}) {
  return {
    id: APPOINTMENT_ID,
    jobId: "00000000-0000-4000-8000-000000000003",
    applicationId: "00000000-0000-4000-8000-000000000004",
    status,
    statusNote: null,
    version: 1,
    parentCompletedAt: null,
    teacherCompletedAt: null,
    completedAt: null,
    job: { ownerId: "00000000-0000-4000-8000-000000000005" },
    application: {
      teacherId: "00000000-0000-4000-8000-000000000006",
      status: ApplicationStatus.ACCEPTED
    },
    ...overrides
  };
}

function serviceWithAppointment(record: ReturnType<typeof appointment>) {
  const tx = {
    $queryRawUnsafe: jest.fn().mockResolvedValue([{ id: APPOINTMENT_ID }]),
    appointment: {
      findUnique: jest.fn().mockResolvedValue(record),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: jest.fn().mockResolvedValue(record)
    },
    jobPost: { findUnique: jest.fn().mockResolvedValue(record.job) },
    application: {
      findUnique: jest.fn().mockResolvedValue(record.application),
      update: jest.fn().mockResolvedValue({})
    },
    outboxEvent: { create: jest.fn().mockResolvedValue({}) },
    auditLog: { create: jest.fn().mockResolvedValue({}) }
  };
  const prisma = {
    $transaction: jest.fn((callback: (transaction: typeof tx) => unknown) => callback(tx))
  };
  return {
    service: new AdminService(prisma as never, { get: jest.fn() } as never),
    tx
  };
}

describe("AdminService appointment command safety", () => {
  it.each([
    [AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED],
    [AppointmentStatus.CONFIRMED, AppointmentStatus.COMPLETED]
  ])("does not let an administrator forge %s -> %s", async (current, target) => {
    const { service, tx } = serviceWithAppointment(appointment(current));

    await expect(service.updateAppointmentStatus(ADMIN_ID, APPOINTMENT_ID, {
      status: target,
      note: "管理员不能代替合作方确认",
      version: 1
    })).rejects.toBeInstanceOf(ConflictException);
    expect(tx.appointment.updateMany).not.toHaveBeenCalled();
  });

  it("emits a separate appointment event and audit when admin cancellation cascades from an accepted application", async () => {
    const applicationId = "00000000-0000-4000-8000-000000000004";
    const beforeAppointment = appointment(AppointmentStatus.CONFIRMED);
    const beforeApplication = {
      id: applicationId,
      jobId: beforeAppointment.jobId,
      teacherId: beforeAppointment.application.teacherId,
      status: ApplicationStatus.ACCEPTED,
      statusNote: null,
      version: 1,
      job: { id: beforeAppointment.jobId, ownerId: beforeAppointment.job.ownerId },
      appointment: beforeAppointment
    };
    const cancelledApplication = { ...beforeApplication, status: ApplicationStatus.CANCELLED, version: 2 };
    const cancelledAppointment = { ...beforeAppointment, status: AppointmentStatus.CANCELLED, version: 2 };
    const tx = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([{ jobId: beforeAppointment.jobId }]),
      application: {
        findUnique: jest.fn().mockResolvedValue(beforeApplication),
        update: jest.fn().mockResolvedValue(cancelledApplication),
        findUniqueOrThrow: jest.fn().mockResolvedValue(cancelledApplication)
      },
      jobPost: { findUnique: jest.fn().mockResolvedValue(beforeApplication.job) },
      appointment: {
        findUnique: jest.fn().mockResolvedValue(beforeAppointment),
        update: jest.fn().mockResolvedValue(cancelledAppointment)
      },
      outboxEvent: { create: jest.fn().mockResolvedValue({}) },
      auditLog: { create: jest.fn().mockResolvedValue({}) }
    };
    const prisma = {
      $transaction: jest.fn((callback: (transaction: typeof tx) => unknown) => callback(tx))
    };
    const service = new AdminService(prisma as never, { get: jest.fn() } as never);

    await service.updateApplicationStatus(ADMIN_ID, applicationId, {
      status: ApplicationStatus.CANCELLED,
      note: "争议协商后终止合作",
      version: 1
    });

    expect(tx.outboxEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        aggregateType: "Appointment",
        eventType: "appointment.cancelled"
      })
    }));
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: "appointment.cancel.admin_linked_application" })
    }));
  });

  it("only resolves a disputed appointment as completed when all completion evidence already exists", async () => {
    const { service, tx } = serviceWithAppointment(appointment(AppointmentStatus.DISPUTED));

    await expect(service.updateAppointmentStatus(ADMIN_ID, APPOINTMENT_ID, {
      status: AppointmentStatus.COMPLETED,
      note: "争议处理结论",
      version: 1
    })).rejects.toBeInstanceOf(ConflictException);
    expect(tx.appointment.updateMany).not.toHaveBeenCalled();
  });

  it("does not synthesize completion timestamps while resolving a fully evidenced dispute", async () => {
    const completedAt = new Date("2026-07-16T08:00:00.000Z");
    const before = appointment(AppointmentStatus.DISPUTED, {
      parentCompletedAt: completedAt,
      teacherCompletedAt: completedAt,
      completedAt
    });
    const after = { ...before, status: AppointmentStatus.COMPLETED, version: 2 };
    const { service, tx } = serviceWithAppointment(before);
    tx.appointment.findUniqueOrThrow.mockResolvedValue(after);

    await expect(service.updateAppointmentStatus(ADMIN_ID, APPOINTMENT_ID, {
      status: AppointmentStatus.COMPLETED,
      note: "双方凭证完整，争议已核实",
      version: 1
    })).resolves.toEqual(after);
    expect(tx.appointment.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.not.objectContaining({
        parentCompletedAt: expect.anything(),
        teacherCompletedAt: expect.anything(),
        completedAt: expect.anything()
      })
    }));
  });
});
