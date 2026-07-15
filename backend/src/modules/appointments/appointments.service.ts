import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash } from "crypto";
import { ApplicationStatus, AppointmentStatus, RoleCode } from "../../generated/prisma/enums";
import { PrismaService } from "../../prisma/prisma.service";

type AppointmentCommand = "confirm" | "complete" | "cancel" | "dispute";

@Injectable()
export class AppointmentsService {
  constructor(private readonly prisma: PrismaService) {}

  private normalizeCommand(
    command: AppointmentCommand,
    idempotencyKey: string,
    activeRole?: RoleCode,
    reason?: string
  ) {
    const key = idempotencyKey?.trim();
    if (!key || key.length > 128) {
      throw new BadRequestException("缺少有效的 Idempotency-Key 请求头");
    }
    const normalizedReason = reason?.trim() || null;
    const requestHash = createHash("sha256")
      .update(JSON.stringify({ command, activeRole: activeRole || null, reason: normalizedReason }))
      .digest("hex");
    return { key, normalizedReason, requestHash };
  }

  private assertMatchingCommand(storedHash: string | null, requestHash: string) {
    if (!storedHash || storedHash !== requestHash) {
      throw new ConflictException("Idempotency-Key 已用于不同的预约操作");
    }
  }

  private presentCommandResponse<T>(record: T): T {
    return JSON.parse(JSON.stringify(record)) as T;
  }

  async list(accountId: string, activeRole?: RoleCode) {
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
        },
        reviews: {
          where: { reviewerId: accountId },
          select: {
            id: true,
            reviewerRole: true,
            revieweeRole: true,
            rating: true,
            tags: true,
            content: true,
            status: true,
            createdAt: true
          },
          take: 1
        }
      },
      orderBy: { updatedAt: "desc" }
    });
    return appointments.map((appointment) => {
      const { reviews, ...appointmentRecord } = appointment;
      const { owner, contactEncrypted: _contactEncrypted, ...job } = appointment.job;
      const canViewPreciseLocation =
        job.ownerId === accountId ||
        appointment.application.status === ApplicationStatus.ACCEPTED ||
        owner.preference?.privacyMode === false;
      const latitude = job.latitude === null ? null : Number(job.latitude);
      const longitude = job.longitude === null ? null : Number(job.longitude);
      const isOwner = job.ownerId === accountId;
      const isTeacher = appointment.application.teacherId === accountId;
      const participantRole = isOwner ? RoleCode.PARENT : isTeacher ? RoleCode.TEACHER : null;
      const activeParticipantRole =
        activeRole === RoleCode.PARENT && isOwner
          ? RoleCode.PARENT
          : activeRole === RoleCode.TEACHER && isTeacher
            ? RoleCode.TEACHER
            : null;
      const parentAcknowledged = appointment.parentCompletedAt !== null;
      const teacherAcknowledged = appointment.teacherCompletedAt !== null;
      const participantAcknowledged = participantRole === RoleCode.PARENT ? parentAcknowledged : teacherAcknowledged;
      const otherPartyAcknowledged = participantRole === RoleCode.PARENT ? teacherAcknowledged : parentAcknowledged;
      const pendingRoles = appointment.status === AppointmentStatus.CONFIRMED
        ? [
            ...(parentAcknowledged ? [] : [RoleCode.PARENT]),
            ...(teacherAcknowledged ? [] : [RoleCode.TEACHER])
          ]
        : [];
      const myReview = reviews?.[0] ?? null;
      const completionVerified =
        appointment.status === AppointmentStatus.COMPLETED &&
        appointment.parentCompletedAt !== null &&
        appointment.teacherCompletedAt !== null &&
        appointment.completedAt !== null;
      const reviewTarget = participantRole === RoleCode.PARENT
        ? {
            accountId: appointment.application.teacherId,
            role: RoleCode.TEACHER,
            label: "本次合作老师"
          }
        : participantRole === RoleCode.TEACHER
          ? {
              accountId: appointment.job.ownerId,
              role: RoleCode.PARENT,
              label: "本次合作家长"
            }
          : null;
      return {
        ...appointmentRecord,
        myReview,
        canReview: completionVerified && activeParticipantRole !== null && myReview === null,
        reviewTarget,
        completionProgress: {
          parentAcknowledged,
          teacherAcknowledged,
          fullyAcknowledged: parentAcknowledged && teacherAcknowledged,
          parentCompletedAt: appointment.parentCompletedAt,
          teacherCompletedAt: appointment.teacherCompletedAt,
          completedAt: appointment.completedAt
        },
        completionActions: {
          canAcknowledge:
            appointment.status === AppointmentStatus.CONFIRMED &&
            activeParticipantRole !== null &&
            !participantAcknowledged,
          hasAcknowledged: participantAcknowledged,
          waitingForOtherParty:
            appointment.status === AppointmentStatus.CONFIRMED && participantAcknowledged && !otherPartyAcknowledged,
          requiresRoleSwitch:
            appointment.status === AppointmentStatus.CONFIRMED &&
            participantRole !== null &&
            activeParticipantRole === null &&
            !participantAcknowledged,
          requiredRole: participantRole,
          pendingRoles
        },
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

  confirm(actorId: string, appointmentId: string, reason: string | undefined, activeRole: RoleCode, idempotencyKey: string) {
    return this.transition(actorId, appointmentId, "confirm", reason, activeRole, idempotencyKey);
  }

  complete(actorId: string, appointmentId: string, reason: string | undefined, activeRole: RoleCode, idempotencyKey: string) {
    return this.acknowledgeCompletion(actorId, appointmentId, reason, activeRole, idempotencyKey);
  }

  cancel(actorId: string, appointmentId: string, reason: string | undefined, activeRole: RoleCode, idempotencyKey: string) {
    return this.transition(actorId, appointmentId, "cancel", reason, activeRole, idempotencyKey);
  }

  dispute(actorId: string, appointmentId: string, reason: string | undefined, activeRole: RoleCode, idempotencyKey: string) {
    return this.transition(actorId, appointmentId, "dispute", reason, activeRole, idempotencyKey);
  }

  private acknowledgeCompletion(
    actorId: string,
    appointmentId: string,
    reason: string | undefined,
    activeRole: RoleCode,
    idempotencyKey: string
  ) {
    const normalized = this.normalizeCommand("complete", idempotencyKey, activeRole, reason);
    const scope = `appointment-command:${appointmentId}`;
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

      let completionRole: RoleCode;
      if (activeRole === RoleCode.PARENT && isOwner) completionRole = RoleCode.PARENT;
      else if (activeRole === RoleCode.TEACHER && isTeacher) completionRole = RoleCode.TEACHER;
      else throw new ForbiddenException("请切换到该预约对应的身份后确认完成");

      const existingKey = await tx.idempotencyRecord.findUnique({
        where: { actorId_scope_key: { actorId, scope, key: normalized.key } }
      });
      if (existingKey?.expiresAt && existingKey.expiresAt > new Date()) {
        this.assertMatchingCommand(existingKey.requestHash, normalized.requestHash);
        return existingKey.response;
      }
      if (existingKey) await tx.idempotencyRecord.delete({ where: { id: existingKey.id } });

      const alreadyAcknowledged = completionRole === RoleCode.PARENT
        ? appointment.parentCompletedAt !== null
        : appointment.teacherCompletedAt !== null;
      if (alreadyAcknowledged) {
        const { job: _job, application: _application, ...appointmentRecord } = appointment;
        return appointmentRecord;
      }
      if (appointment.status !== AppointmentStatus.CONFIRMED) {
        throw new ConflictException("预约当前状态不允许确认完成");
      }

      const acknowledgedAt = new Date();
      const otherPartyAcknowledged = completionRole === RoleCode.PARENT
        ? appointment.teacherCompletedAt !== null
        : appointment.parentCompletedAt !== null;
      const isFullyAcknowledged = otherPartyAcknowledged;
      const updated = await tx.appointment.update({
        where: { id: appointmentId },
        data: {
          ...(completionRole === RoleCode.PARENT
            ? { parentCompletedAt: acknowledgedAt }
            : { teacherCompletedAt: acknowledgedAt }),
          status: isFullyAcknowledged ? AppointmentStatus.COMPLETED : AppointmentStatus.CONFIRMED,
          completedAt: isFullyAcknowledged ? acknowledgedAt : appointment.completedAt,
          statusNote: normalized.normalizedReason ?? appointment.statusNote,
          handledAt: acknowledgedAt,
          version: { increment: 1 }
        }
      });

      const eventType = isFullyAcknowledged ? "appointment.completed" : "appointment.completion_acknowledged";
      await tx.outboxEvent.create({
        data: {
          aggregateType: "Appointment",
          aggregateId: appointmentId,
          eventType,
          payload: {
            appointmentId,
            jobId: appointment.jobId,
            applicationId: appointment.applicationId,
            ownerId: appointment.job.ownerId,
            teacherId: appointment.application.teacherId,
            actorId,
            completionRole,
            reason: normalized.normalizedReason
          }
        }
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: isFullyAcknowledged ? "appointment.complete" : "appointment.completion_acknowledge",
          targetType: "Appointment",
          targetId: appointmentId,
          before: {
            status: appointment.status,
            version: appointment.version,
            parentCompletedAt: appointment.parentCompletedAt?.toISOString() ?? null,
            teacherCompletedAt: appointment.teacherCompletedAt?.toISOString() ?? null
          },
          after: {
            status: updated.status,
            version: updated.version,
            parentCompletedAt: updated.parentCompletedAt?.toISOString() ?? null,
            teacherCompletedAt: updated.teacherCompletedAt?.toISOString() ?? null,
            completedAt: updated.completedAt?.toISOString() ?? null,
            reason: updated.statusNote
          }
        }
      });
      const response = this.presentCommandResponse(updated);
      await tx.idempotencyRecord.create({
        data: {
          actorId,
          scope,
          key: normalized.key,
          requestHash: normalized.requestHash,
          response,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
        }
      });
      return response;
    });
  }

  private transition(
    actorId: string,
    appointmentId: string,
    command: Exclude<AppointmentCommand, "complete">,
    reason: string | undefined,
    activeRole: RoleCode,
    idempotencyKey: string
  ) {
    const normalized = this.normalizeCommand(command, idempotencyKey, activeRole, reason);
    const scope = `appointment-command:${appointmentId}`;
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
      if (command === "confirm" && activeRole !== RoleCode.TEACHER) {
        throw new ForbiddenException("请切换到老师身份后确认预约");
      }
      if (
        (command === "cancel" || command === "dispute") &&
        !(
          (activeRole === RoleCode.PARENT && isOwner) ||
          (activeRole === RoleCode.TEACHER && isTeacher)
        )
      ) {
        throw new ForbiddenException("请切换到该预约对应的身份后操作");
      }
      if ((command === "cancel" || command === "dispute") && !normalized.normalizedReason) {
        throw new BadRequestException(command === "cancel" ? "取消预约必须填写原因" : "发起争议必须填写原因");
      }

      const existingKey = await tx.idempotencyRecord.findUnique({
        where: { actorId_scope_key: { actorId, scope, key: normalized.key } }
      });
      if (existingKey?.expiresAt && existingKey.expiresAt > new Date()) {
        this.assertMatchingCommand(existingKey.requestHash, normalized.requestHash);
        return existingKey.response;
      }
      if (existingKey) await tx.idempotencyRecord.delete({ where: { id: existingKey.id } });

      const nextStatus = this.nextStatus(appointment.status, command);
      const updated = await tx.appointment.update({
        where: { id: appointmentId },
        data: {
          status: nextStatus,
          statusNote: normalized.normalizedReason,
          handledAt: new Date(),
          version: { increment: 1 }
        }
      });

      if (nextStatus === AppointmentStatus.CANCELLED && appointment.application.status === ApplicationStatus.ACCEPTED) {
        await tx.application.update({
          where: { id: appointment.applicationId },
          data: {
            status: ApplicationStatus.CANCELLED,
            statusNote: normalized.normalizedReason || "预约已取消",
            handledAt: new Date(),
            version: { increment: 1 }
          }
        });
      }

      await tx.outboxEvent.create({
        data: {
          aggregateType: "Appointment",
          aggregateId: appointmentId,
          eventType: `appointment.${command === "confirm" ? "confirmed" : command === "cancel" ? "cancelled" : "disputed"}`,
          payload: {
            appointmentId,
            jobId: appointment.jobId,
            applicationId: appointment.applicationId,
            ownerId: appointment.job.ownerId,
            teacherId: appointment.application.teacherId,
            actorId,
            reason: normalized.normalizedReason
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
      const response = this.presentCommandResponse(updated);
      await tx.idempotencyRecord.create({
        data: {
          actorId,
          scope,
          key: normalized.key,
          requestHash: normalized.requestHash,
          response,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
        }
      });
      return response;
    });
  }

  private nextStatus(current: AppointmentStatus, command: Exclude<AppointmentCommand, "complete">): AppointmentStatus {
    const allowed: Record<Exclude<AppointmentCommand, "complete">, AppointmentStatus[]> = {
      confirm: [AppointmentStatus.PENDING],
      cancel: [AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED],
      dispute: [AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED, AppointmentStatus.COMPLETED]
    };
    if (!allowed[command].includes(current)) throw new ConflictException("预约当前状态不允许执行该操作");
    return {
      confirm: AppointmentStatus.CONFIRMED,
      cancel: AppointmentStatus.CANCELLED,
      dispute: AppointmentStatus.DISPUTED
    }[command];
  }

  private approximateCoordinate(value: unknown) {
    return value === null || value === undefined ? null : Math.round(Number(value) * 100) / 100;
  }
}
