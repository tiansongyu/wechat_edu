import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { AccountStatus, ApplicationStatus, AuditStatus, JobStatus, RoleCode } from "../../generated/prisma/enums";
import { PrismaService } from "../../prisma/prisma.service";
import { AdminListDto, AuditDecisionDto, UpdateAccountStatusDto } from "./dto/admin.dto";

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async dashboard() {
    const [users, approvedTeachers, pendingTeachers, publishedJobs, pendingJobs, pendingApplications, recentJobs] =
      await Promise.all([
        this.prisma.account.count({ where: { roles: { some: { roleCode: { in: [RoleCode.PARENT, RoleCode.TEACHER] } } } } }),
        this.prisma.teacherProfile.count({ where: { auditStatus: AuditStatus.APPROVED } }),
        this.prisma.teacherProfile.count({ where: { auditStatus: AuditStatus.PENDING } }),
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
      jobStatusDistribution: recentJobs.map((item) => ({ status: item.status, count: item._count._all }))
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
          status: true,
          createdAt: true,
          roles: { select: { roleCode: true } },
          teacherProfile: { select: { auditStatus: true, score: true } }
        },
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize
      }),
      this.prisma.account.count({ where })
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async updateUserStatus(actorId: string, accountId: string, dto: UpdateAccountStatusDto) {
    if (actorId === accountId && dto.status !== AccountStatus.ACTIVE) {
      throw new BadRequestException("不能停用当前登录的管理员账号");
    }
    const before = await this.prisma.account.findUnique({ where: { id: accountId }, select: { status: true } });
    if (!before) throw new NotFoundException("用户不存在");
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
          before,
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
        where: { auditStatus: AuditStatus.PENDING },
        include: {
          account: { select: { nickname: true, avatarUrl: true, createdAt: true } },
          certifications: true
        },
        orderBy: { updatedAt: "asc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize
      }),
      this.prisma.teacherProfile.count({ where: { auditStatus: AuditStatus.PENDING } })
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async auditTeacher(actorId: string, teacherId: string, dto: AuditDecisionDto) {
    if (dto.status === AuditStatus.PENDING) throw new BadRequestException("请选择通过或拒绝");
    const before = await this.prisma.teacherProfile.findUnique({
      where: { accountId: teacherId },
      select: { auditStatus: true, auditNote: true, version: true }
    });
    if (!before) throw new NotFoundException("教师资料不存在");
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.teacherProfile.update({
        where: { accountId: teacherId },
        data: { auditStatus: dto.status, auditNote: dto.note, version: { increment: 1 } }
      });
      await tx.notification.create({
        data: {
          accountId: teacherId,
          type: "AUDIT",
          title: dto.status === AuditStatus.APPROVED ? "教师认证已通过" : "教师认证需要修改",
          content: dto.note || (dto.status === AuditStatus.APPROVED ? "你现在可以报名家教需求。" : "请完善资料后重新提交。")
        }
      });
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
    const before = await this.prisma.jobPost.findUnique({
      where: { id: jobId },
      select: { status: true, auditNote: true, version: true, ownerId: true }
    });
    if (!before) throw new NotFoundException("家教信息不存在");
    const nextStatus = dto.status === AuditStatus.APPROVED ? JobStatus.PUBLISHED : JobStatus.REJECTED;
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.jobPost.update({
        where: { id: jobId },
        data: {
          status: nextStatus,
          auditNote: dto.note,
          publishedAt: nextStatus === JobStatus.PUBLISHED ? new Date() : null,
          version: { increment: 1 }
        }
      });
      await tx.notification.create({
        data: {
          accountId: before.ownerId,
          type: "AUDIT",
          title: nextStatus === JobStatus.PUBLISHED ? "发布审核已通过" : "发布审核未通过",
          content: dto.note || (nextStatus === JobStatus.PUBLISHED ? "信息已经公开展示。" : "请修改后重新提交。"),
          data: { jobId }
        }
      });
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
