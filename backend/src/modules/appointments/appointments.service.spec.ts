import { ForbiddenException } from "@nestjs/common";
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

    await expect(service.complete(PARENT_ID, APPOINTMENT_ID, undefined, RoleCode.PARENT)).resolves.toEqual(updated);

    expect(tx.appointment.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: AppointmentStatus.CONFIRMED, parentCompletedAt: expect.any(Date) })
    }));
    expect(tx.outboxEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ eventType: "appointment.completion_acknowledged" })
    }));
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

    await expect(service.complete(TEACHER_ID, APPOINTMENT_ID, undefined, RoleCode.TEACHER)).resolves.toEqual(updated);

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

    await expect(service.complete(PARENT_ID, APPOINTMENT_ID, undefined, RoleCode.PARENT)).resolves.toEqual(appointmentRecord);
    expect(tx.appointment.update).not.toHaveBeenCalled();
    expect(tx.outboxEvent.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it("requires the active role matching the participant side", async () => {
    const { service, tx } = serviceWith(confirmedAppointment());

    await expect(service.complete(PARENT_ID, APPOINTMENT_ID, undefined, RoleCode.TEACHER))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.appointment.update).not.toHaveBeenCalled();
  });
});
