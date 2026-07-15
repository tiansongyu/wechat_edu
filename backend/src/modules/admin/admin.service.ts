import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AccountStatus, ApplicationStatus, AppointmentStatus, AuditStatus, JobStatus, RoleCode } from "../../generated/prisma/enums";
import { PrismaService } from "../../prisma/prisma.service";
import {
  AdminApplicationListDto,
  AdminApplicationStatusDto,
  AdminAppointmentListDto,
  AdminAppointmentStatusDto,
  AdminListDto,
  AuditDecisionDto,
  UpdateAccountStatusDto
} from "./dto/admin.dto";

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  async dashboard() {
    const [users, approvedTeachers, pendingTeachers, publishedJobs, pendingJobs, pendingApplications, recentJobs] =
      await Promise.all([
        this.prisma.account.count({ where: { roles: { some: { roleCode: { in: [RoleCode.PARENT, RoleCode.TEACHER] } } } } }),
        this.prisma.teacherProfile.count({ where: { auditStatus: AuditStatus.APPROVED } }),
        this.prisma.teacherProfile.count({ where: { auditStatus: AuditStatus.PENDING, submittedAt: { not: null } } }),
        this.prisma.jobPost.count({ where: { status: JobStatus.PUBLISHED } }),
        this.prisma.jobPost.count({ where: { status: JobStatus.PENDING } }),
        this.prisma.application.count({ where: { status: ApplicationStatus.PENDING } }),
        this.prisma.jobPost.groupBy({
          by: ["status"],
          _count: { _all: true },
          orderBy: { status: "asc" }
        })
      ]);
    return {
      metrics: { users, approvedTeachers, pendingTeachers, publishedJobs, pendingJobs, pendingApplications },
      jobStatusDistribution: recentJobs.map((item) => ({ status: item.status, count: item._count._all })),
      integrations: {
        wechatLogin: this.config.get<string>("WECHAT_LOGIN_MOCK") === "true" ? "MOCK" : "LIVE",
        wechatConfigured: Boolean(
          this.config.get<string>("WECHAT_APP_ID") && this.config.get<string>("WECHAT_APP_SECRET")
        )
      }
    };
  }

  async users(query: AdminListDto) {
    const where = query.keyword ? {
      OR: [
        { nickname: { contains: query.keyword, mode: "insensitive" as const } },
        { username: { contains: query.keyword, mode: "insensitive" as const } }
      ]
    } : {};
    const [items, total] = await Promise.all([
      this.prisma.account.findMany({
        where,
        select: {
          id: true,
          nickname: true,
          avatarUrl: true,
          username: true,
          openid: true,
          status: true,
          lastLoginAt: true,
          loginCount: true,
          createdAt: true,
          roles: { select: { roleCode: true } },
          teacherProfile: { select: { auditStatus: true } }
        },
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize
      }),
      this.prisma.account.count({ where })
    ]);
    return {
      items: items.map(({ openid, ...item }) => ({
        ...item,
        loginProvider: item.username ? "ADMIN" : openid ? "WECHAT" : "UNKNOWN"
      })),
      total,
      page: query.page,
      pageSize: query.pageSize
    };
  }

  async updateUserStatus(actorId: string, accountId: string, dto: UpdateAccountStatusDto) {
    if (actorId === accountId && dto.status !== AccountStatus.ACTIVE) {
      throw new BadRequestException("不能停用当前登录的管理员账号");
    }
    const before = await this.prisma.account.findUnique({
      where: { id: accountId },
      select: { status: true, roles: { select: { roleCode: true } } }
    });
    if (!before) throw new NotFoundException("用户不存在");
    if (dto.status !== AccountStatus.ACTIVE && before.roles.some((role) => role.roleCode === RoleCode.ADMIN)) {
      throw new BadRequestException("不能停用或删除管理员账号");
    }
    const account = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.account.update({ where: { id: accountId }, data: { status: dto.status } });
      if (dto.status !== AccountStatus.ACTIVE) {
        await tx.refreshSession.updateMany({ where: { accountId, revokedAt: null }, data: { revokedAt: new Date() } });
      }
      await tx.auditLog.create({
        data: {
          actorId,
          action: "account.status.update",
          targetType: "Account",
          targetId: accountId,
          before: { status: before.status },
          after: { status: dto.status, note: dto.note || null }
        }
      });
      return updated;
    });
    return account;
  }

  async teacherAudits(query: AdminListDto) {
    const [items, total] = await Promise.all([
      this.prisma.teacherProfile.findMany({
        where: { auditStatus: AuditStatus.PENDING, submittedAt: { not: null } },
        include: {
          account: { select: { nickname: true, avatarUrl: true, createdAt: true } },
          certifications: true
        },
        orderBy: { updatedAt: "asc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize
      }),
      this.prisma.teacherProfile.count({ where: { auditStatus: AuditStatus.PENDING, submittedAt: { not: null } } })
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async auditTeacher(actorId: string, teacherId: string, dto: AuditDecisionDto) {
    if (dto.status === AuditStatus.PENDING) throw new BadRequestException("请选择通过或拒绝");
    if (dto.status === AuditStatus.REJECTED && !dto.note?.trim()) throw new BadRequestException("拒绝必须填写原因");
    const before = await this.prisma.teacherProfile.findUnique({
      where: { accountId: teacherId },
      select: { auditStatus: true, auditNote: true, version: true }
    });
    if (!before) throw new NotFoundException("教师资料不存在");
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.teacherProfile.updateMany({
        where: {
          accountId: teacherId,
          auditStatus: AuditStatus.PENDING,
          submittedAt: { not: null },
          version: dto.version ?? before.version
        },
        data: { auditStatus: dto.status, auditNote: dto.note, version: { increment: 1 } }
      });
      if (!result.count) throw new ConflictException("资料已被其他管理员处理，请刷新后重试");
      await tx.teacherCertification.updateMany({
        where: { teacherId, auditStatus: AuditStatus.PENDING },
        data: { auditStatus: dto.status, auditNote: dto.note }
      });
      const updated = await tx.teacherProfile.findUniqueOrThrow({ where: { accountId: teacherId } });
      const preference = await tx.userPreference.findUnique({ where: { accountId: teacherId }, select: { jobNotice: true } });
      if (preference?.jobNotice !== false) {
        await tx.notification.create({
          data: {
            accountId: teacherId,
            type: "AUDIT",
            title: dto.status === AuditStatus.APPROVED ? "教师认证已通过" : "教师认证需要修改",
            content: dto.note || (dto.status === AuditStatus.APPROVED ? "你现在可以报名家教需求。" : "请完善资料后重新提交。")
          }
        });
      }
      await tx.auditLog.create({
        data: {
          actorId,
          action: "teacher.audit",
          targetType: "TeacherProfile",
          targetId: teacherId,
          before,
          after: { status: dto.status, note: dto.note || null }
        }
      });
      return updated;
    });
  }

  async jobAudits(query: AdminListDto) {
    const [items, total] = await Promise.all([
      this.prisma.jobPost.findMany({
        where: { status: JobStatus.PENDING },
        include: { owner: { select: { nickname: true, avatarUrl: true } } },
        orderBy: { createdAt: "asc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize
      }),
      this.prisma.jobPost.count({ where: { status: JobStatus.PENDING } })
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async auditJob(actorId: string, jobId: string, dto: AuditDecisionDto) {
    if (dto.status === AuditStatus.PENDING) throw new BadRequestException("请选择通过或拒绝");
    if (dto.status === AuditStatus.REJECTED && !dto.note?.trim()) throw new BadRequestException("拒绝必须填写原因");
    const before = await this.prisma.jobPost.findUnique({
      where: { id: jobId },
      select: { status: true, auditNote: true, version: true, ownerId: true }
    });
    if (!before) throw new NotFoundException("家教信息不存在");
    const nextStatus = dto.status === AuditStatus.APPROVED ? JobStatus.PUBLISHED : JobStatus.REJECTED;
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.jobPost.updateMany({
        where: { id: jobId, status: JobStatus.PENDING, version: dto.version ?? before.version },
        data: {
          status: nextStatus,
          auditNote: dto.note,
          publishedAt: nextStatus === JobStatus.PUBLISHED ? new Date() : null,
          version: { increment: 1 }
        }
      });
      if (!result.count) throw new ConflictException("发布已被其他管理员处理，请刷新后重试");
      const updated = await tx.jobPost.findUniqueOrThrow({ where: { id: jobId } });
      const preference = await tx.userPreference.findUnique({ where: { accountId: before.ownerId }, select: { jobNotice: true } });
      if (preference?.jobNotice !== false) {
        await tx.notification.create({
          data: {
            accountId: before.ownerId,
            type: "AUDIT",
            title: nextStatus === JobStatus.PUBLISHED ? "发布审核已通过" : "发布审核未通过",
            content: dto.note || (nextStatus === JobStatus.PUBLISHED ? "信息已经公开展示。" : "请修改后重新提交。"),
            data: { jobId }
          }
        });
      }
      await tx.auditLog.create({
        data: {
          actorId,
          action: "job.audit",
          targetType: "JobPost",
          targetId: jobId,
          before: { status: before.status, note: before.auditNote, version: before.version },
          after: { status: nextStatus, note: dto.note || null }
        }
      });
      return updated;
    });
  }

  async applications(query: AdminApplicationListDto) {
    const where = query.status ? { status: query.status } : {};
    const [items, total] = await Promise.all([
      this.prisma.application.findMany({
        where,
        include: {
          job: { include: { owner: { select: { id: true, nickname: true, avatarUrl: true } } } },
          teacher: { select: { id: true, nickname: true, avatarUrl: true, teacherProfile: true } },
          appointment: true
        },
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize
      }),
      this.prisma.application.count({ where })
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async updateApplicationStatus(actorId: string, applicationId: string, dto: AdminApplicationStatusDto) {
    if ((dto.status === ApplicationStatus.REJECTED || dto.status === ApplicationStatus.CANCELLED) && !dto.note?.trim()) {
      throw new BadRequestException("拒绝或取消必须填写原因");
    }
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRawUnsafe<Array<{ jobId: string }>>(
        `SELECT "jobId" FROM applications WHERE id = $1::uuid FOR UPDATE`,
        applicationId
      );
      if (!rows.length) throw new NotFoundException("报名记录不存在");
      await tx.$queryRawUnsafe(`SELECT id FROM job_posts WHERE id = $1::uuid FOR UPDATE`, rows[0].jobId);
      const application = await tx.application.findUnique({
        where: { id: applicationId },
        include: { job: true, appointment: true }
      });
      if (!application) throw new NotFoundException("报名记录不存在");
      if (application.version !== dto.version) throw new ConflictException("报名记录已变化，请刷新后重试");
      if (application.status === dto.status) throw new ConflictException("报名已经是目标状态");

      const allowed: ApplicationStatus[] =
        application.status === ApplicationStatus.PENDING
          ? [ApplicationStatus.ACCEPTED, ApplicationStatus.REJECTED, ApplicationStatus.CANCELLED]
          : application.status === ApplicationStatus.ACCEPTED
            ? [ApplicationStatus.CANCELLED]
            : [];
      if (!allowed.includes(dto.status)) throw new ConflictException("报名当前状态不允许该操作");

      if (
        dto.status === ApplicationStatus.CANCELLED &&
        application.appointment?.status === AppointmentStatus.COMPLETED
      ) {
        throw new ConflictException("预约已完成，不能撤销录用");
      }

      if (dto.status === ApplicationStatus.ACCEPTED) {
        if (application.job.status !== JobStatus.PUBLISHED) throw new ConflictException("该发布当前不可录用");
        const acceptedCount = await tx.application.count({
          where: { jobId: application.jobId, status: ApplicationStatus.ACCEPTED }
        });
        if (acceptedCount >= application.job.capacity) throw new ConflictException("该发布名额已满");
        await tx.application.update({
          where: { id: applicationId },
          data: { status: dto.status, statusNote: dto.note || "管理员确认录用", handledAt: new Date(), version: { increment: 1 } }
        });
        await tx.appointment.create({ data: { jobId: application.jobId, applicationId, note: dto.note } });
        if (acceptedCount + 1 >= application.job.capacity) {
          const remaining = await tx.application.findMany({
            where: { jobId: application.jobId, status: ApplicationStatus.PENDING },
            select: { id: true, teacherId: true }
          });
          await tx.jobPost.update({ where: { id: application.jobId }, data: { status: JobStatus.CLOSED, version: { increment: 1 } } });
          await tx.application.updateMany({
            where: { jobId: application.jobId, status: ApplicationStatus.PENDING },
            data: { status: ApplicationStatus.REJECTED, statusNote: "该需求名额已满", handledAt: new Date(), version: { increment: 1 } }
          });
          for (const item of remaining) {
            await tx.outboxEvent.create({
              data: {
                aggregateType: "Application",
                aggregateId: item.id,
                eventType: "application.rejected",
                payload: { applicationId: item.id, teacherId: item.teacherId, jobId: application.jobId, note: "该需求名额已满" }
              }
            });
          }
        }
      } else {
        await tx.application.update({
          where: { id: applicationId },
          data: { status: dto.status, statusNote: dto.note?.trim(), handledAt: new Date(), version: { increment: 1 } }
        });
        if (dto.status === ApplicationStatus.CANCELLED && application.appointment) {
          await tx.appointment.updateMany({
            where: {
              id: application.appointment.id,
              status: { in: [AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED, AppointmentStatus.DISPUTED] }
            },
            data: { status: AppointmentStatus.CANCELLED, statusNote: dto.note?.trim(), handledAt: new Date(), version: { increment: 1 } }
          });
        }
      }

      const updated = await tx.application.findUniqueOrThrow({ where: { id: applicationId } });
      const eventType = dto.status === ApplicationStatus.ACCEPTED
        ? "application.accepted"
        : dto.status === ApplicationStatus.REJECTED
          ? "application.rejected"
          : "application.cancelled";
      await tx.outboxEvent.create({
        data: {
          aggregateType: "Application",
          aggregateId: applicationId,
          eventType,
          payload: {
            applicationId,
            teacherId: application.teacherId,
            ownerId: application.job.ownerId,
            jobId: application.jobId,
            actorId,
            note: updated.statusNote
          }
        }
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: "application.status.admin",
          targetType: "Application",
          targetId: applicationId,
          before: { status: application.status, version: application.version },
          after: { status: updated.status, version: updated.version, note: updated.statusNote }
        }
      });
      return updated;
    });
  }

  async appointments(query: AdminAppointmentListDto) {
    const where = query.status ? { status: query.status } : {};
    const [items, total] = await Promise.all([
      this.prisma.appointment.findMany({
        where,
        include: {
          job: { include: { owner: { select: { id: true, nickname: true, avatarUrl: true } } } },
          application: {
            include: { teacher: { select: { id: true, nickname: true, avatarUrl: true, teacherProfile: true } } }
          }
        },
        orderBy: { updatedAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize
      }),
      this.prisma.appointment.count({ where })
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async updateAppointmentStatus(actorId: string, appointmentId: string, dto: AdminAppointmentStatusDto) {
    if ((dto.status === AppointmentStatus.CANCELLED || dto.status === AppointmentStatus.DISPUTED) && !dto.note?.trim()) {
      throw new BadRequestException("取消或争议操作必须填写原因");
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(`SELECT id FROM appointments WHERE id = $1::uuid FOR UPDATE`, appointmentId);
      const appointment = await tx.appointment.findUnique({
        where: { id: appointmentId },
        include: { job: true, application: true }
      });
      if (!appointment) throw new NotFoundException("预约不存在");
      if (appointment.version !== dto.version) throw new ConflictException("预约记录已变化，请刷新后重试");
      if (appointment.status === dto.status) throw new ConflictException("预约已经是目标状态");
      const transitions: Record<AppointmentStatus, AppointmentStatus[]> = {
        PENDING: [AppointmentStatus.CONFIRMED, AppointmentStatus.CANCELLED, AppointmentStatus.DISPUTED],
        CONFIRMED: [AppointmentStatus.COMPLETED, AppointmentStatus.CANCELLED, AppointmentStatus.DISPUTED],
        COMPLETED: [AppointmentStatus.DISPUTED],
        CANCELLED: [],
        DISPUTED: [AppointmentStatus.COMPLETED, AppointmentStatus.CANCELLED]
      };
      if (!transitions[appointment.status].includes(dto.status)) throw new ConflictException("预约当前状态不允许该操作");
      const handledAt = new Date();
      const completionData = dto.status === AppointmentStatus.COMPLETED
        ? {
            parentCompletedAt: appointment.parentCompletedAt ?? handledAt,
            teacherCompletedAt: appointment.teacherCompletedAt ?? handledAt,
            completedAt: appointment.completedAt ?? handledAt
          }
        : {};
      const result = await tx.appointment.updateMany({
        where: { id: appointmentId, version: dto.version },
        data: {
          status: dto.status,
          statusNote: dto.note?.trim() || null,
          handledAt,
          ...completionData,
          version: { increment: 1 }
        }
      });
      if (!result.count) throw new ConflictException("预约记录已变化，请刷新后重试");
      const updated = await tx.appointment.findUniqueOrThrow({ where: { id: appointmentId } });
      if (dto.status === AppointmentStatus.CANCELLED && appointment.application.status === ApplicationStatus.ACCEPTED) {
        await tx.application.update({
          where: { id: appointment.applicationId },
          data: { status: ApplicationStatus.CANCELLED, statusNote: dto.note?.trim(), handledAt: new Date(), version: { increment: 1 } }
        });
      }
      const suffix = {
        CONFIRMED: "confirmed",
        COMPLETED: "completed",
        CANCELLED: "cancelled",
        DISPUTED: "disputed",
        PENDING: "pending"
      }[dto.status];
      await tx.outboxEvent.create({
        data: {
          aggregateType: "Appointment",
          aggregateId: appointmentId,
          eventType: `appointment.${suffix}`,
          payload: {
            appointmentId,
            jobId: appointment.jobId,
            applicationId: appointment.applicationId,
            ownerId: appointment.job.ownerId,
            teacherId: appointment.application.teacherId,
            actorId,
            reason: updated.statusNote
          }
        }
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: "appointment.status.admin",
          targetType: "Appointment",
          targetId: appointmentId,
          before: { status: appointment.status, version: appointment.version },
          after: {
            status: updated.status,
            version: updated.version,
            note: updated.statusNote,
            parentCompletedAt: updated.parentCompletedAt?.toISOString() ?? null,
            teacherCompletedAt: updated.teacherCompletedAt?.toISOString() ?? null,
            completedAt: updated.completedAt?.toISOString() ?? null
          }
        }
      });
      return updated;
    });
  }

  async auditLogs(query: AdminListDto) {
    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        include: { actor: { select: { nickname: true, username: true } } },
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize
      }),
      this.prisma.auditLog.count()
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }
}
