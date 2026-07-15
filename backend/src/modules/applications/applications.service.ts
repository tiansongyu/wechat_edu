import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash } from "crypto";
import { ApplicationStatus, AuditStatus, JobStatus, JobType } from "../../generated/prisma/enums";
import { PrismaService } from "../../prisma/prisma.service";
import { ApplyJobDto } from "./dto/applications.dto";

type ApplicationCommand = "accept" | "reject" | "cancel";

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

  private normalizeCommand(command: ApplicationCommand, idempotencyKey: string, note?: string) {
    const key = idempotencyKey?.trim();
    if (!key || key.length > 128) {
      throw new BadRequestException("缺少有效的 Idempotency-Key 请求头");
    }
    const normalizedNote = note?.trim() || null;
    const requestHash = createHash("sha256")
      .update(JSON.stringify({ command, note: normalizedNote }))
      .digest("hex");
    return { key, normalizedNote, requestHash };
  }

  private assertMatchingCommand(storedHash: string | null, requestHash: string) {
    if (!storedHash || storedHash !== requestHash) {
      throw new ConflictException("Idempotency-Key 已用于不同的报名操作");
    }
  }

  private presentCommandResponse<T>(record: T): T {
    return JSON.parse(JSON.stringify(record)) as T;
  }

  async apply(teacherId: string, jobId: string, idempotencyKey: string, dto: ApplyJobDto) {
    const key = idempotencyKey?.trim();
    if (!key || key.length > 128) {
      throw new BadRequestException("缺少有效的 Idempotency-Key 请求头");
    }
    const coverLetter = dto.coverLetter?.trim() || "";
    const requestHash = createHash("sha256")
      .update(JSON.stringify({ command: "apply", coverLetter }))
      .digest("hex");
    const scope = `apply:${jobId}`;
    const cached = await this.prisma.idempotencyRecord.findUnique({
      where: { actorId_scope_key: { actorId: teacherId, scope, key } }
    });
    if (cached && cached.expiresAt > new Date()) {
      if (cached.requestHash !== requestHash) {
        throw new ConflictException("Idempotency-Key 已用于不同的报名内容");
      }
      return cached.response;
    }

    return this.retrySerializable(() => this.prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(`SELECT id FROM job_posts WHERE id = $1::uuid FOR UPDATE`, jobId);
      const existingKey = await tx.idempotencyRecord.findUnique({
        where: { actorId_scope_key: { actorId: teacherId, scope, key } }
      });
      if (existingKey?.expiresAt && existingKey.expiresAt > new Date()) {
        if (existingKey.requestHash !== requestHash) {
          throw new ConflictException("Idempotency-Key 已用于不同的报名内容");
        }
        return existingKey.response;
      }
      if (existingKey) await tx.idempotencyRecord.delete({ where: { id: existingKey.id } });

      // The transaction uses one PostgreSQL connection; avoid concurrent
      // client.query calls that pg has deprecated for removal in pg 9.
      const job = await tx.jobPost.findUnique({ where: { id: jobId } });
      const teacher = await tx.teacherProfile.findUnique({ where: { accountId: teacherId } });
      const existingApplication = await tx.application.findUnique({
        where: { jobId_teacherId: { jobId, teacherId } }
      });
      if (!job) throw new NotFoundException("家教需求不存在");
      if (job.type !== JobType.TEACHING_NEED || job.status !== JobStatus.PUBLISHED) {
        throw new ConflictException("该需求当前不可报名");
      }
      if (job.ownerId === teacherId) throw new ForbiddenException("不能报名自己发布的需求");
      if (!teacher || teacher.auditStatus !== AuditStatus.APPROVED) {
        throw new ForbiddenException("教师资料通过认证后才能报名");
      }
      if (existingApplication && existingApplication.status !== ApplicationStatus.CANCELLED) {
        throw new ConflictException("你已经报名过该需求");
      }

      const application = existingApplication
        ? await tx.application.update({
            where: { id: existingApplication.id },
            data: {
              coverLetter,
              status: ApplicationStatus.PENDING,
              statusNote: null,
              handledAt: null,
              version: { increment: 1 }
            }
          })
        : await tx.application.create({ data: { jobId, teacherId, coverLetter } });
      if (!existingApplication) {
        await tx.jobPost.update({ where: { id: jobId }, data: { applicationCount: { increment: 1 } } });
      }
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
          key,
          requestHash,
          response,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
        }
      });
      await tx.auditLog.create({
        data: {
          actorId: teacherId,
          action: existingApplication ? "application.reapply" : "application.create",
          targetType: "Application",
          targetId: application.id,
          before: existingApplication ? { status: existingApplication.status, version: existingApplication.version } : undefined,
          after: { jobId, status: application.status, version: application.version }
        }
      });
      return response;
    }, { isolationLevel: "Serializable" }));
  }

  async teacherApplications(teacherId: string) {
    const applications = await this.prisma.application.findMany({
      where: { teacherId },
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
        }
      },
      orderBy: { createdAt: "desc" }
    });
    return applications.map((application) => {
      const { owner, contactEncrypted: _contactEncrypted, ...job } = application.job;
      const canViewPreciseLocation =
        application.status === ApplicationStatus.ACCEPTED || owner.preference?.privacyMode === false;
      const latitude = job.latitude === null ? null : Number(job.latitude);
      const longitude = job.longitude === null ? null : Number(job.longitude);
      return {
        ...application,
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

  parentApplications(ownerId: string) {
    return this.prisma.application.findMany({
      where: { job: { ownerId } },
      include: {
        job: true,
        teacher: { select: { id: true, nickname: true, avatarUrl: true, teacherProfile: true } },
        appointment: true
      },
      orderBy: { createdAt: "desc" }
    });
  }

  async accept(ownerId: string, applicationId: string, note: string | undefined, idempotencyKey: string) {
    const normalized = this.normalizeCommand("accept", idempotencyKey, note);
    const scope = `application-command:${applicationId}`;
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

      const existingKey = await tx.idempotencyRecord.findUnique({
        where: { actorId_scope_key: { actorId: ownerId, scope, key: normalized.key } }
      });
      if (existingKey?.expiresAt && existingKey.expiresAt > new Date()) {
        this.assertMatchingCommand(existingKey.requestHash, normalized.requestHash);
        return existingKey.response;
      }
      if (existingKey) await tx.idempotencyRecord.delete({ where: { id: existingKey.id } });

      if (application.status !== ApplicationStatus.PENDING) throw new ConflictException("该报名已经处理");
      if (application.job.status !== JobStatus.PUBLISHED) throw new ConflictException("该需求当前不可录用");
      const accepted = await tx.application.count({
        where: { jobId: application.jobId, status: ApplicationStatus.ACCEPTED }
      });
      if (accepted >= application.job.capacity) throw new ConflictException("该需求名额已满");

      const updated = await tx.application.update({
        where: { id: applicationId },
        data: {
          status: ApplicationStatus.ACCEPTED,
          statusNote: normalized.normalizedNote || "发布者已接受报名",
          handledAt: new Date(),
          version: { increment: 1 }
        }
      });
      await tx.appointment.create({
        data: { jobId: application.jobId, applicationId, note }
      });
      if (accepted + 1 >= application.job.capacity) {
        await tx.jobPost.update({
          where: { id: application.jobId },
          data: { status: JobStatus.CLOSED, version: { increment: 1 } }
        });
        const remaining = await tx.application.findMany({
          where: { jobId: application.jobId, status: ApplicationStatus.PENDING },
          select: { id: true, teacherId: true }
        });
        await tx.application.updateMany({
          where: { jobId: application.jobId, status: ApplicationStatus.PENDING },
          data: {
            status: ApplicationStatus.REJECTED,
            statusNote: "该需求名额已满",
            handledAt: new Date(),
            version: { increment: 1 }
          }
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
      await tx.outboxEvent.create({
        data: {
          aggregateType: "Application",
          aggregateId: applicationId,
          eventType: "application.accepted",
          payload: { applicationId, teacherId: application.teacherId, jobId: application.jobId }
        }
      });
      await tx.auditLog.create({
        data: {
          actorId: ownerId,
          action: "application.accept",
          targetType: "Application",
          targetId: applicationId,
          before: { status: application.status, version: application.version },
          after: { status: updated.status, version: updated.version, note: updated.statusNote }
        }
      });
      const response = this.presentCommandResponse(updated);
      await tx.idempotencyRecord.create({
        data: {
          actorId: ownerId,
          scope,
          key: normalized.key,
          requestHash: normalized.requestHash,
          response,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
        }
      });
      return response;
    }, { isolationLevel: "Serializable" }));
  }

  async reject(ownerId: string, applicationId: string, note: string | undefined, idempotencyKey: string) {
    const normalized = this.normalizeCommand("reject", idempotencyKey, note);
    const reason = normalized.normalizedNote;
    if (!reason) throw new BadRequestException("拒绝报名必须填写原因");
    const scope = `application-command:${applicationId}`;
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

      const existingKey = await tx.idempotencyRecord.findUnique({
        where: { actorId_scope_key: { actorId: ownerId, scope, key: normalized.key } }
      });
      if (existingKey?.expiresAt && existingKey.expiresAt > new Date()) {
        this.assertMatchingCommand(existingKey.requestHash, normalized.requestHash);
        return existingKey.response;
      }
      if (existingKey) await tx.idempotencyRecord.delete({ where: { id: existingKey.id } });

      if (application.status !== ApplicationStatus.PENDING) throw new ConflictException("该报名已经处理");
      const updated = await tx.application.update({
        where: { id: applicationId },
        data: {
          status: ApplicationStatus.REJECTED,
          statusNote: reason,
          handledAt: new Date(),
          version: { increment: 1 }
        }
      });
      await tx.outboxEvent.create({
        data: {
          aggregateType: "Application",
          aggregateId: applicationId,
          eventType: "application.rejected",
          payload: { applicationId, teacherId: application.teacherId, jobId: application.jobId, note: reason }
        }
      });
      await tx.auditLog.create({
        data: {
          actorId: ownerId,
          action: "application.reject",
          targetType: "Application",
          targetId: applicationId,
          before: { status: application.status, version: application.version },
          after: { status: updated.status, version: updated.version, note: updated.statusNote }
        }
      });
      const response = this.presentCommandResponse(updated);
      await tx.idempotencyRecord.create({
        data: {
          actorId: ownerId,
          scope,
          key: normalized.key,
          requestHash: normalized.requestHash,
          response,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
        }
      });
      return response;
    }, { isolationLevel: "Serializable" }));
  }


  async cancel(teacherId: string, applicationId: string, note: string | undefined, idempotencyKey: string) {
    const normalized = this.normalizeCommand("cancel", idempotencyKey, note);
    const reason = normalized.normalizedNote;
    if (!reason) throw new BadRequestException("取消报名必须填写原因");
    const scope = `application-command:${applicationId}`;
    return this.retrySerializable(() => this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRawUnsafe<Array<{ jobId: string }>>(
        `SELECT "jobId" FROM applications WHERE id = $1::uuid FOR UPDATE`,
        applicationId
      );
      if (!rows.length) throw new NotFoundException("报名记录不存在");
      const application = await tx.application.findUnique({
        where: { id: applicationId },
        include: { job: true }
      });
      if (!application) throw new NotFoundException("报名记录不存在");
      if (application.teacherId !== teacherId) throw new ForbiddenException("只能取消自己的报名");

      const existingKey = await tx.idempotencyRecord.findUnique({
        where: { actorId_scope_key: { actorId: teacherId, scope, key: normalized.key } }
      });
      if (existingKey?.expiresAt && existingKey.expiresAt > new Date()) {
        this.assertMatchingCommand(existingKey.requestHash, normalized.requestHash);
        return existingKey.response;
      }
      if (existingKey) await tx.idempotencyRecord.delete({ where: { id: existingKey.id } });

      if (application.status !== ApplicationStatus.PENDING) throw new ConflictException("只有待处理报名可以取消");
      const updated = await tx.application.update({
        where: { id: applicationId },
        data: {
          status: ApplicationStatus.CANCELLED,
          statusNote: reason,
          handledAt: new Date(),
          version: { increment: 1 }
        }
      });
      await tx.outboxEvent.create({
        data: {
          aggregateType: "Application",
          aggregateId: applicationId,
          eventType: "application.cancelled",
          payload: {
            applicationId,
            teacherId,
            actorId: teacherId,
            ownerId: application.job.ownerId,
            jobId: application.jobId,
            note: updated.statusNote
          }
        }
      });
      await tx.auditLog.create({
        data: {
          actorId: teacherId,
          action: "application.cancel",
          targetType: "Application",
          targetId: applicationId,
          before: { status: application.status, version: application.version },
          after: { status: updated.status, version: updated.version, note: updated.statusNote }
        }
      });
      const response = this.presentCommandResponse(updated);
      await tx.idempotencyRecord.create({
        data: {
          actorId: teacherId,
          scope,
          key: normalized.key,
          requestHash: normalized.requestHash,
          response,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
        }
      });
      return response;
    }, { isolationLevel: "Serializable" }));
  }

  private approximateCoordinate(value: unknown) {
    return value === null || value === undefined ? null : Math.round(Number(value) * 100) / 100;
  }
}
