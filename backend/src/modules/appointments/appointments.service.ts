import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { ApplicationStatus, AppointmentStatus } from "../../generated/prisma/enums";
import { PrismaService } from "../../prisma/prisma.service";

type AppointmentCommand = "confirm" | "complete" | "cancel" | "dispute";

@Injectable()
export class AppointmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(accountId: string) {
    const appointments = await this.prisma.appointment.findMany({
      where: {
        OR: [
          { job: { ownerId: accountId } },
          { application: { teacherId: accountId } }
        ]
      },
      include: {
        job: {
          include: {
            owner: {
              select: {
                id: true,
                nickname: true,
                avatarUrl: true,
                preference: { select: { privacyMode: true } }
              }
            }
          }
        },
        application: {
          include: { teacher: { select: { id: true, nickname: true, avatarUrl: true, teacherProfile: true } } }
        }
      },
      orderBy: { updatedAt: "desc" }
    });
    return appointments.map((appointment) => {
      const { owner, contactEncrypted: _contactEncrypted, ...job } = appointment.job;
      const canViewPreciseLocation =
        job.ownerId === accountId ||
        appointment.application.status === ApplicationStatus.ACCEPTED ||
        owner.preference?.privacyMode === false;
      const latitude = job.latitude === null ? null : Number(job.latitude);
      const longitude = job.longitude === null ? null : Number(job.longitude);
      return {
        ...appointment,
        job: {
          ...job,
          address: canViewPreciseLocation ? job.address : null,
          latitude: canViewPreciseLocation ? latitude : this.approximateCoordinate(latitude),
          longitude: canViewPreciseLocation ? longitude : this.approximateCoordinate(longitude),
          locationApproximate: !canViewPreciseLocation,
          owner: { id: owner.id, nickname: owner.nickname, avatarUrl: owner.avatarUrl }
        }
      };
    });
  }

  confirm(actorId: string, appointmentId: string, reason?: string) {
    return this.transition(actorId, appointmentId, "confirm", reason);
  }

  complete(actorId: string, appointmentId: string, reason?: string) {
    return this.transition(actorId, appointmentId, "complete", reason);
  }

  cancel(actorId: string, appointmentId: string, reason?: string) {
    return this.transition(actorId, appointmentId, "cancel", reason);
  }

  dispute(actorId: string, appointmentId: string, reason?: string) {
    return this.transition(actorId, appointmentId, "dispute", reason);
  }

  private transition(actorId: string, appointmentId: string, command: AppointmentCommand, reason?: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(`SELECT id FROM appointments WHERE id = $1::uuid FOR UPDATE`, appointmentId);
      const appointment = await tx.appointment.findUnique({
        where: { id: appointmentId },
        include: { job: true, application: true }
      });
      if (!appointment) throw new NotFoundException("预约不存在");

      const isOwner = appointment.job.ownerId === actorId;
      const isTeacher = appointment.application.teacherId === actorId;
      if (!isOwner && !isTeacher) throw new ForbiddenException("无权处理该预约");
      if (command === "confirm" && !isTeacher) throw new ForbiddenException("只有报名教师可以确认预约");
      if (command === "complete" && !isOwner) throw new ForbiddenException("只有发布者可以确认完成");
      if ((command === "cancel" || command === "dispute") && !reason?.trim()) {
        throw new BadRequestException(command === "cancel" ? "取消预约必须填写原因" : "发起争议必须填写原因");
      }

      const nextStatus = this.nextStatus(appointment.status, command);
      const updated = await tx.appointment.update({
        where: { id: appointmentId },
        data: {
          status: nextStatus,
          statusNote: reason?.trim() || null,
          handledAt: new Date(),
          version: { increment: 1 }
        }
      });

      if (nextStatus === AppointmentStatus.CANCELLED && appointment.application.status === ApplicationStatus.ACCEPTED) {
        await tx.application.update({
          where: { id: appointment.applicationId },
          data: {
            status: ApplicationStatus.CANCELLED,
            statusNote: reason?.trim() || "预约已取消",
            handledAt: new Date(),
            version: { increment: 1 }
          }
        });
      }

      await tx.outboxEvent.create({
        data: {
          aggregateType: "Appointment",
          aggregateId: appointmentId,
          eventType: `appointment.${command === "complete" ? "completed" : command === "confirm" ? "confirmed" : command === "cancel" ? "cancelled" : "disputed"}`,
          payload: {
            appointmentId,
            jobId: appointment.jobId,
            applicationId: appointment.applicationId,
            ownerId: appointment.job.ownerId,
            teacherId: appointment.application.teacherId,
            actorId,
            reason: reason?.trim() || null
          }
        }
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: `appointment.${command}`,
          targetType: "Appointment",
          targetId: appointmentId,
          before: { status: appointment.status, version: appointment.version },
          after: { status: updated.status, version: updated.version, reason: updated.statusNote }
        }
      });
      return updated;
    });
  }

  private nextStatus(current: AppointmentStatus, command: AppointmentCommand): AppointmentStatus {
    const allowed: Record<AppointmentCommand, AppointmentStatus[]> = {
      confirm: [AppointmentStatus.PENDING],
      complete: [AppointmentStatus.CONFIRMED],
      cancel: [AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED],
      dispute: [AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED, AppointmentStatus.COMPLETED]
    };
    if (!allowed[command].includes(current)) throw new ConflictException("预约当前状态不允许执行该操作");
    return {
      confirm: AppointmentStatus.CONFIRMED,
      complete: AppointmentStatus.COMPLETED,
      cancel: AppointmentStatus.CANCELLED,
      dispute: AppointmentStatus.DISPUTED
    }[command];
  }

  private approximateCoordinate(value: unknown) {
    return value === null || value === undefined ? null : Math.round(Number(value) * 100) / 100;
  }
}
