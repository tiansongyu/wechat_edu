import { ConflictException, ForbiddenException } from "@nestjs/common";
import { createHash } from "crypto";
import { AppointmentStatus, ApplicationStatus, RoleCode } from "../../generated/prisma/enums";
import { AppointmentsService } from "./appointments.service";

const APPOINTMENT_ID = "00000000-0000-4000-8000-000000000010";
const JOB_ID = "00000000-0000-4000-8000-000000000020";
const APPLICATION_ID = "00000000-0000-4000-8000-000000000021";
const PARENT_ID = "00000000-0000-4000-8000-000000000011";
const TEACHER_ID = "00000000-0000-4000-8000-000000000012";

function confirmedAppointment(overrides: Record<string, unknown> = {}) {
  return {
    id: APPOINTMENT_ID,
    jobId: JOB_ID,
    applicationId: APPLICATION_ID,
    status: AppointmentStatus.CONFIRMED,
    statusNote: null,
    version: 2,
    handledAt: new Date("2026-07-16T00:00:00.000Z"),
    parentCompletedAt: null,
    teacherCompletedAt: null,
    completedAt: null,
    createdAt: new Date("2026-07-16T00:00:00.000Z"),
    updatedAt: new Date("2026-07-16T00:00:00.000Z"),
    startAt: null,
    note: null,
    job: { id: JOB_ID, ownerId: PARENT_ID },
    application: { id: APPLICATION_ID, teacherId: TEACHER_ID, status: ApplicationStatus.ACCEPTED },
    ...overrides
  };
}

function serviceWith(appointment: ReturnType<typeof confirmedAppointment>, updated = appointment) {
  const tx = {
    $queryRawUnsafe: jest.fn().mockResolvedValue([{ id: APPOINTMENT_ID }]),
    appointment: {
      findUnique: jest.fn().mockResolvedValue(appointment),
      update: jest.fn().mockResolvedValue(updated)
    },
    application: { update: jest.fn().mockResolvedValue({}) },
    idempotencyRecord: {
      findUnique: jest.fn().mockResolvedValue(null),
      delete: jest.fn().mockResolvedValue({}),
      create: jest.fn().mockResolvedValue({})
    },
    outboxEvent: { create: jest.fn().mockResolvedValue({}) },
    auditLog: { create: jest.fn().mockResolvedValue({}) }
  };
  const prisma = {
    $transaction: jest.fn((callback: (transaction: typeof tx) => unknown) => callback(tx))
  };
  return { service: new AppointmentsService(prisma as never), tx };
}

describe("AppointmentsService completion acknowledgements", () => {
  it("keeps the appointment confirmed after the first party acknowledges completion", async () => {
    const appointment = confirmedAppointment();
    const updated = confirmedAppointment({
      parentCompletedAt: new Date("2026-07-16T01:00:00.000Z"),
      version: 3
    });
    const { service, tx } = serviceWith(appointment, updated);

    await expect(service.complete(
      PARENT_ID,
      APPOINTMENT_ID,
      undefined,
      RoleCode.PARENT,
      "parent-completion-key"
    )).resolves.toEqual(JSON.parse(JSON.stringify(updated)));

    expect(tx.appointment.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: AppointmentStatus.CONFIRMED, parentCompletedAt: expect.any(Date) })
    }));
    expect(tx.outboxEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ eventType: "appointment.completion_acknowledged" })
    }));
    expect(tx.idempotencyRecord.create).toHaveBeenCalledTimes(1);
  });

  it("marks the appointment completed after the other party acknowledges", async () => {
    const parentCompletedAt = new Date("2026-07-16T01:00:00.000Z");
    const appointment = confirmedAppointment({ parentCompletedAt });
    const updated = confirmedAppointment({
      status: AppointmentStatus.COMPLETED,
      parentCompletedAt,
      teacherCompletedAt: new Date("2026-07-16T02:00:00.000Z"),
      completedAt: new Date("2026-07-16T02:00:00.000Z"),
      version: 3
    });
    const { service, tx } = serviceWith(appointment, updated);

    await expect(service.complete(
      TEACHER_ID,
      APPOINTMENT_ID,
      undefined,
      RoleCode.TEACHER,
      "teacher-completion-key"
    )).resolves.toEqual(JSON.parse(JSON.stringify(updated)));

    expect(tx.appointment.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: AppointmentStatus.COMPLETED,
        teacherCompletedAt: expect.any(Date),
        completedAt: expect.any(Date)
      })
    }));
    expect(tx.outboxEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ eventType: "appointment.completed" })
    }));
  });

  it("returns idempotently without another event when the same party retries", async () => {
    const appointment = confirmedAppointment({ parentCompletedAt: new Date("2026-07-16T01:00:00.000Z") });
    const { service, tx } = serviceWith(appointment);
    const { job: _job, application: _application, ...appointmentRecord } = appointment;

    await expect(service.complete(
      PARENT_ID,
      APPOINTMENT_ID,
      undefined,
      RoleCode.PARENT,
      "already-complete-key"
    )).resolves.toEqual(appointmentRecord);
    expect(tx.appointment.update).not.toHaveBeenCalled();
    expect(tx.outboxEvent.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it("requires the active role matching the participant side", async () => {
    const { service, tx } = serviceWith(confirmedAppointment());

    await expect(service.complete(
      PARENT_ID,
      APPOINTMENT_ID,
      undefined,
      RoleCode.TEACHER,
      "wrong-role-key"
    ))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.appointment.update).not.toHaveBeenCalled();
  });

  it("requires cancel to use the active role matching the participant side", async () => {
    const { service, tx } = serviceWith(confirmedAppointment());

    await expect(service.cancel(
      PARENT_ID,
      APPOINTMENT_ID,
      "时间冲突",
      RoleCode.TEACHER,
      "wrong-cancel-role-key"
    )).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.appointment.update).not.toHaveBeenCalled();
    expect(tx.idempotencyRecord.create).not.toHaveBeenCalled();
  });

  it("returns the original response for the same normalized command key", async () => {
    const cachedResponse = { id: APPOINTMENT_ID, status: AppointmentStatus.CONFIRMED, version: 3 };
    const { service, tx } = serviceWith(confirmedAppointment());
    const requestHash = createHash("sha256")
      .update(JSON.stringify({ command: "complete", activeRole: RoleCode.PARENT, reason: "课程完成" }))
      .digest("hex");
    tx.idempotencyRecord.findUnique.mockResolvedValue({
      id: "cached-key",
      requestHash,
      response: cachedResponse,
      expiresAt: new Date(Date.now() + 60_000)
    } as never);

    await expect(service.complete(
      PARENT_ID,
      APPOINTMENT_ID,
      "  课程完成  ",
      RoleCode.PARENT,
      "same-command-key"
    )).resolves.toEqual(cachedResponse);
    expect(tx.appointment.update).not.toHaveBeenCalled();
    expect(tx.outboxEvent.create).not.toHaveBeenCalled();
  });

  it("rejects reusing an appointment command key with different content", async () => {
    const { service, tx } = serviceWith(confirmedAppointment());
    tx.idempotencyRecord.findUnique.mockResolvedValue({
      id: "cached-key",
      requestHash: "different-command-hash",
      response: { id: APPOINTMENT_ID },
      expiresAt: new Date(Date.now() + 60_000)
    } as never);

    await expect(service.complete(
      PARENT_ID,
      APPOINTMENT_ID,
      "课程完成",
      RoleCode.PARENT,
      "reused-command-key"
    )).rejects.toBeInstanceOf(ConflictException);
    expect(tx.appointment.update).not.toHaveBeenCalled();
  });
});
