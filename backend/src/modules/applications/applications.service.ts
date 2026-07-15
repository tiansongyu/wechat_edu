import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { ApplicationStatus, AuditStatus, JobStatus, JobType } from "../../generated/prisma/enums";
import { PrismaService } from "../../prisma/prisma.service";
import { ApplyJobDto } from "./dto/applications.dto";

@Injectable()
export class ApplicationsService {
  constructor(private readonly prisma: PrismaService) {}

  private isSerializableConflict(error: unknown) {
    if (typeof error !== "object" || error === null) return false;
    const candidate = error as {
      code?: unknown;
      meta?: { driverAdapterError?: { cause?: { originalCode?: unknown } } };
    };
    const databaseCode = candidate.meta?.driverAdapterError?.cause?.originalCode;
    return candidate.code === "P2034" || databaseCode === "40001";
  }

  private async retrySerializable<T>(operation: () => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        if (!this.isSerializableConflict(error) || attempt === 2) throw error;
        await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)));
      }
    }
    throw new ConflictException("请求冲突，请稍后重试");
  }

  async apply(teacherId: string, jobId: string, idempotencyKey: string, dto: ApplyJobDto) {
    if (!idempotencyKey || idempotencyKey.length > 128) {
      throw new BadRequestException("缺少有效的 Idempotency-Key 请求头");
    }
    const scope = `apply:${jobId}`;
    const cached = await this.prisma.idempotencyRecord.findUnique({
      where: { actorId_scope_key: { actorId: teacherId, scope, key: idempotencyKey } }
    });
    if (cached) return cached.response;

    return this.retrySerializable(() => this.prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(`SELECT id FROM job_posts WHERE id = $1::uuid FOR UPDATE`, jobId);
      const existingKey = await tx.idempotencyRecord.findUnique({
        where: { actorId_scope_key: { actorId: teacherId, scope, key: idempotencyKey } }
      });
      if (existingKey) return existingKey.response;

      const [job, teacher, existingApplication] = await Promise.all([
        tx.jobPost.findUnique({ where: { id: jobId } }),
        tx.teacherProfile.findUnique({ where: { accountId: teacherId } }),
        tx.application.findUnique({ where: { jobId_teacherId: { jobId, teacherId } } })
      ]);
      if (!job) throw new NotFoundException("家教需求不存在");
      if (job.type !== JobType.TEACHING_NEED || job.status !== JobStatus.PUBLISHED) {
        throw new ConflictException("该需求当前不可报名");
      }
      if (job.ownerId === teacherId) throw new ForbiddenException("不能报名自己发布的需求");
      if (!teacher || teacher.auditStatus !== AuditStatus.APPROVED) {
        throw new ForbiddenException("教师资料通过认证后才能报名");
      }
      if (existingApplication) throw new ConflictException("你已经报名过该需求");

      const application = await tx.application.create({
        data: { jobId, teacherId, coverLetter: dto.coverLetter },
        include: { job: true }
      });
      await tx.jobPost.update({ where: { id: jobId }, data: { applicationCount: { increment: 1 } } });
      await tx.outboxEvent.create({
        data: {
          aggregateType: "Application",
          aggregateId: application.id,
          eventType: "application.created",
          payload: { applicationId: application.id, jobId, teacherId, ownerId: job.ownerId }
        }
      });
      const response = {
        id: application.id,
        jobId,
        status: application.status,
        createdAt: application.createdAt.toISOString()
      };
      await tx.idempotencyRecord.create({
        data: {
          actorId: teacherId,
          scope,
          key: idempotencyKey,
          response,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
        }
      });
      return response;
    }, { isolationLevel: "Serializable" }));
  }

  teacherApplications(teacherId: string) {
    return this.prisma.application.findMany({
      where: { teacherId },
      include: { job: { include: { owner: { select: { nickname: true, avatarUrl: true } } } } },
      orderBy: { createdAt: "desc" }
    });
  }

  async jobApplications(ownerId: string, jobId: string) {
    const job = await this.prisma.jobPost.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException("家教需求不存在");
    if (job.ownerId !== ownerId) throw new ForbiddenException("只能查看自己发布需求的报名");
    return this.prisma.application.findMany({
      where: { jobId },
      include: {
        teacher: {
          select: {
            id: true,
            nickname: true,
            avatarUrl: true,
            teacherProfile: true
          }
        }
      },
      orderBy: { createdAt: "desc" }
    });
  }

  async accept(ownerId: string, applicationId: string, note?: string) {
    return this.retrySerializable(() => this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRawUnsafe<Array<{ jobId: string }>>(
        `SELECT "jobId" FROM applications WHERE id = $1::uuid FOR UPDATE`,
        applicationId
      );
      if (!rows.length) throw new NotFoundException("报名记录不存在");
      await tx.$queryRawUnsafe(`SELECT id FROM job_posts WHERE id = $1::uuid FOR UPDATE`, rows[0].jobId);
      const application = await tx.application.findUnique({
        where: { id: applicationId },
        include: { job: true }
      });
      if (!application) throw new NotFoundException("报名记录不存在");
      if (application.job.ownerId !== ownerId) throw new ForbiddenException("只能处理自己需求的报名");
      if (application.status !== ApplicationStatus.PENDING) throw new ConflictException("该报名已经处理");
      const accepted = await tx.application.count({
        where: { jobId: application.jobId, status: ApplicationStatus.ACCEPTED }
      });
      if (accepted >= application.job.capacity) throw new ConflictException("该需求名额已满");

      const updated = await tx.application.update({
        where: { id: applicationId },
        data: { status: ApplicationStatus.ACCEPTED, handledAt: new Date(), version: { increment: 1 } }
      });
      await tx.appointment.create({
        data: { jobId: application.jobId, applicationId, note }
      });
      if (accepted + 1 >= application.job.capacity) {
        await tx.jobPost.update({ where: { id: application.jobId }, data: { status: JobStatus.CLOSED } });
      }
      await tx.outboxEvent.create({
        data: {
          aggregateType: "Application",
          aggregateId: applicationId,
          eventType: "application.accepted",
          payload: { applicationId, teacherId: application.teacherId, jobId: application.jobId }
        }
      });
      return updated;
    }, { isolationLevel: "Serializable" }));
  }

  async reject(ownerId: string, applicationId: string, note?: string) {
    return this.retrySerializable(() => this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRawUnsafe<Array<{ jobId: string }>>(
        `SELECT "jobId" FROM applications WHERE id = $1::uuid FOR UPDATE`,
        applicationId
      );
      if (!rows.length) throw new NotFoundException("报名记录不存在");
      await tx.$queryRawUnsafe(`SELECT id FROM job_posts WHERE id = $1::uuid FOR UPDATE`, rows[0].jobId);
      const application = await tx.application.findUnique({
        where: { id: applicationId },
        include: { job: true }
      });
      if (!application) throw new NotFoundException("报名记录不存在");
      if (application.job.ownerId !== ownerId) throw new ForbiddenException("只能处理自己需求的报名");
      if (application.status !== ApplicationStatus.PENDING) throw new ConflictException("该报名已经处理");
      const updated = await tx.application.update({
        where: { id: applicationId },
        data: { status: ApplicationStatus.REJECTED, handledAt: new Date(), version: { increment: 1 } }
      });
      await tx.outboxEvent.create({
        data: {
          aggregateType: "Application",
          aggregateId: applicationId,
          eventType: "application.rejected",
          payload: { applicationId, teacherId: application.teacherId, jobId: application.jobId, note: note || null }
        }
      });
      return updated;
    }, { isolationLevel: "Serializable" }));
  }
}
