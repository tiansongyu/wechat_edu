import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApplicationStatus, AuditStatus, JobStatus, JobType, RoleCode } from "../../generated/prisma/enums";
import { RequestUser } from "../../common/interfaces/request-user";
import { PrismaService } from "../../prisma/prisma.service";
import { CONTACT_PATTERN, CreateJobDto, JobSort, ListJobsDto, NearbyJobsDto, UpdateJobDto } from "./dto/jobs.dto";

@Injectable()
export class JobsService {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  async list(query: ListJobsDto, accountId: string) {
    const limit = query.limit || 20;
    if (query.minPriceCents !== undefined && query.maxPriceCents !== undefined && query.minPriceCents > query.maxPriceCents) {
      throw new BadRequestException("最低课酬不能高于最高课酬");
    }
    const subjects = query.subjects?.length ? query.subjects : query.subject ? [query.subject] : undefined;
    const grades = query.grades?.length ? query.grades : query.grade ? [query.grade] : undefined;
    const orderBy = query.sort === JobSort.PRICE_ASC
      ? [{ priceCents: "asc" as const }, { id: "asc" as const }]
      : query.sort === JobSort.PRICE_DESC
        ? [{ priceCents: "desc" as const }, { id: "desc" as const }]
        : [{ publishedAt: "desc" as const }, { id: "desc" as const }];
    const jobs = await this.prisma.jobPost.findMany({
      where: {
        status: JobStatus.PUBLISHED,
        type: query.type,
        district: query.district,
        grade: grades ? { in: grades } : undefined,
        subject: subjects ? { in: subjects } : undefined,
        settlement: query.settlement,
        priceCents: query.minPriceCents !== undefined || query.maxPriceCents !== undefined ? {
          gte: query.minPriceCents,
          lte: query.maxPriceCents
        } : undefined,
        ...(query.keyword ? {
          OR: [
            { title: { contains: query.keyword, mode: "insensitive" as const } },
            { description: { contains: query.keyword, mode: "insensitive" as const } },
            { studentInfo: { contains: query.keyword, mode: "insensitive" as const } },
            { grade: { contains: query.keyword, mode: "insensitive" as const } },
            { subject: { contains: query.keyword, mode: "insensitive" as const } },
            { area: { contains: query.keyword, mode: "insensitive" as const } },
            { city: { contains: query.keyword, mode: "insensitive" as const } },
            { district: { contains: query.keyword, mode: "insensitive" as const } },
            { owner: { nickname: { contains: query.keyword, mode: "insensitive" as const } } }
          ]
        } : {})
      },
      include: {
        owner: {
          select: {
            id: true,
            nickname: true,
            avatarUrl: true,
            preference: { select: { privacyMode: true } },
            teacherProfile: {
              select: {
                displayTitle: true, school: true, major: true, education: true, teachingYears: true,
                subjects: true, serviceAreas: true, teachingStyle: true, teachingAchievements: true,
                examExperience: true, languages: true, availableTimes: true, serviceModes: true,
                lessonFormats: true, bio: true, auditStatus: true
              }
            }
          }
        },
        favorites: { where: { accountId }, select: { accountId: true } },
        applications: { where: { teacherId: accountId }, take: 1 }
      },
      orderBy,
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {})
    });
    const hasMore = jobs.length > limit;
    const items = hasMore ? jobs.slice(0, limit) : jobs;
    return {
      items: items.map((job) => this.present(job, accountId)),
      nextCursor: hasMore ? items[items.length - 1].id : null
    };
  }

  async nearby(query: NearbyJobsDto, accountId: string) {
    const radius = query.radiusKm * 1000;
    const values: Array<string | number | null> = [query.longitude, query.latitude, radius, accountId];
    const filters: string[] = [];
    if (query.type) {
      values.push(query.type);
      filters.push(`AND j."type" = $${values.length}::"JobType"`);
    }
    if (query.district) {
      values.push(query.district);
      filters.push(`AND j."district" = $${values.length}`);
    }
    if (query.grade) {
      values.push(query.grade);
      filters.push(`AND j."grade" = $${values.length}`);
    }
    if (query.subject) {
      values.push(query.subject);
      filters.push(`AND j."subject" = $${values.length}`);
    }
    if (query.keyword) {
      values.push(`%${query.keyword}%`);
      filters.push(`AND (j.title ILIKE $${values.length} OR j.description ILIKE $${values.length} OR j.area ILIKE $${values.length})`);
    }
    values.push(query.cursor || null);
    const cursorIndex = values.length;
    const limit = query.limit || 20;
    values.push(limit + 1);
    const limitIndex = values.length;
    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `WITH origin AS (
         SELECT ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography AS point
       ), candidates AS (
         SELECT j.id, j."type", j.title, j.province, j.city, j.district, j.area, j.grade, j.subject,
                j."priceCents", j."priceUnit", j.settlement, j.schedule, j.description,
                j.address, j."studentInfo", j."publishedAt", j.latitude, j.longitude,
                owner.id AS "ownerId", owner.nickname AS "ownerNickname", owner."avatarUrl" AS "ownerAvatarUrl",
                COALESCE(preference."privacyMode", TRUE) AS "privacyMode",
                favorite."accountId" AS "favoriteAccountId",
                application.id AS "applicationId", application.status AS "applicationStatus",
                application."statusNote" AS "applicationStatusNote", application.version AS "applicationVersion",
                ST_Distance(j.location, origin.point) AS "distanceMeters"
         FROM job_posts j
         CROSS JOIN origin
         JOIN accounts owner ON owner.id = j."ownerId"
         LEFT JOIN user_preferences preference ON preference."accountId" = owner.id
         LEFT JOIN favorites favorite ON favorite."jobId" = j.id AND favorite."accountId" = $4::uuid
         LEFT JOIN applications application ON application."jobId" = j.id AND application."teacherId" = $4::uuid
         WHERE j.status = 'PUBLISHED'::"JobStatus"
           AND BTRIM(j.district) <> '线上'
           AND j.location IS NOT NULL
           AND ST_DWithin(j.location, origin.point, $3)
           ${filters.join(" ")}
       ), cursor_position AS (
         SELECT "distanceMeters" AS "cursorDistance"
         FROM candidates
         WHERE id = $${cursorIndex}::uuid
       )
       SELECT candidates.*
       FROM candidates
       LEFT JOIN cursor_position ON TRUE
       WHERE $${cursorIndex}::uuid IS NULL
          OR (cursor_position."cursorDistance" IS NOT NULL AND (
               candidates."distanceMeters" > cursor_position."cursorDistance"
               OR (candidates."distanceMeters" = cursor_position."cursorDistance" AND candidates.id > $${cursorIndex}::uuid)
          ))
       ORDER BY candidates."distanceMeters" ASC, candidates.id ASC
       LIMIT $${limitIndex}`,
      ...values
    );
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    return {
      items: items.map((row) => {
        const {
          ownerId,
          ownerNickname,
          ownerAvatarUrl,
          privacyMode,
          favoriteAccountId,
          applicationId,
          applicationStatus,
          applicationStatusNote,
          applicationVersion,
          ...job
        } = row;
        return this.present({
          ...job,
          ownerId,
          privacyMode,
          owner: { id: ownerId, nickname: ownerNickname, avatarUrl: ownerAvatarUrl },
          favorites: favoriteAccountId ? [{ accountId: favoriteAccountId }] : [],
          applications: applicationId
            ? [{ id: applicationId, status: applicationStatus, statusNote: applicationStatusNote, version: applicationVersion }]
            : [],
          distanceMeters: Number(row.distanceMeters)
        }, accountId);
      }),
      nextCursor: hasMore ? items[items.length - 1].id : null
    };
  }

  async detail(id: string, accountId: string) {
    const job = await this.prisma.jobPost.findUnique({
      where: { id },
      include: {
        owner: {
          select: {
            id: true,
            nickname: true,
            avatarUrl: true,
            preference: { select: { privacyMode: true } },
            teacherProfile: {
              select: {
                displayTitle: true, school: true, major: true, education: true, teachingYears: true,
                subjects: true, serviceAreas: true, teachingStyle: true, teachingAchievements: true,
                examExperience: true, languages: true, availableTimes: true, serviceModes: true,
                lessonFormats: true, bio: true, auditStatus: true
              }
            }
          }
        },
        favorites: { where: { accountId }, select: { accountId: true } },
        applications: { where: { teacherId: accountId }, take: 1 }
      }
    });
    if (!job) throw new NotFoundException("家教信息不存在");
    const canReadUnpublished = job.ownerId === accountId || job.applications.length > 0;
    if (job.status !== JobStatus.PUBLISHED && !canReadUnpublished) {
      throw new NotFoundException("家教信息不存在");
    }
    return this.present(job, accountId);
  }

  async mine(ownerId: string) {
    const jobs = await this.prisma.jobPost.findMany({
      where: { ownerId },
      include: {
        owner: {
          select: {
            id: true,
            nickname: true,
            avatarUrl: true,
            preference: { select: { privacyMode: true } },
            teacherProfile: {
              select: {
                displayTitle: true, school: true, major: true, education: true, teachingYears: true,
                subjects: true, serviceAreas: true, teachingStyle: true, teachingAchievements: true,
                examExperience: true, languages: true, availableTimes: true, serviceModes: true,
                lessonFormats: true, bio: true, auditStatus: true
              }
            }
          }
        },
        favorites: { where: { accountId: ownerId }, select: { accountId: true } },
        applications: { where: { teacherId: ownerId }, take: 1 },
        revisions: { where: { status: AuditStatus.PENDING }, orderBy: { createdAt: "desc" }, take: 1 }
      },
      orderBy: { createdAt: "desc" }
    });
    return jobs.map((job) => this.present(job, ownerId));
  }

  async favorites(accountId: string) {
    const rows = await this.prisma.favorite.findMany({
      where: {
        accountId,
        job: {
          OR: [
            { status: JobStatus.PUBLISHED },
            { ownerId: accountId },
            { applications: { some: { teacherId: accountId } } }
          ]
        }
      },
      include: {
        job: {
          include: {
            owner: {
              select: {
                id: true,
                nickname: true,
                avatarUrl: true,
                preference: { select: { privacyMode: true } },
                teacherProfile: {
                  select: {
                    displayTitle: true, school: true, major: true, education: true, teachingYears: true,
                    subjects: true, serviceAreas: true, teachingStyle: true, teachingAchievements: true,
                    examExperience: true, languages: true, availableTimes: true, serviceModes: true,
                    lessonFormats: true, bio: true, auditStatus: true
                  }
                }
              }
            },
            favorites: { where: { accountId }, select: { accountId: true } },
            applications: { where: { teacherId: accountId }, take: 1 }
          }
        }
      },
      orderBy: { createdAt: "desc" }
    });
    return rows.map((row) => this.present(row.job, accountId));
  }

  async create(user: RequestUser, dto: CreateJobDto) {
    if (dto.type === JobType.TEACHING_NEED && user.activeRole !== RoleCode.PARENT) {
      throw new ForbiddenException("只有家长角色可以发布家教需求");
    }
    if (dto.type === JobType.TEACHER_OFFER && user.activeRole !== RoleCode.TEACHER) {
      throw new ForbiddenException("只有老师角色可以发布求带信息");
    }
    const district = this.requiredText(dto.district, "授课区域");
    const online = district === "线上";
    const province = online ? null : this.requiredText(dto.province || "", "省份");
    const city = online ? null : this.requiredText(dto.city || "", "城市");
    if (!online && (dto.latitude === undefined || dto.longitude === undefined)) {
      throw new BadRequestException("线下授课必须提供完整经纬度");
    }
    if (!online && !dto.address?.trim()) throw new BadRequestException("线下授课必须通过地图选择详细地点");
    const latitude = online ? null : dto.latitude;
    const longitude = online ? null : dto.longitude;
    const contact = this.normalizeContact(dto.contact);
    return this.prisma.$transaction(async (tx) => {
      const job = await tx.jobPost.create({
        data: {
          ownerId: user.id,
          type: dto.type,
          title: this.requiredText(dto.title, "标题"),
          province,
          city,
          district,
          area: this.nullableText(dto.area),
          grade: this.requiredText(dto.grade, "年级"),
          subject: this.requiredText(dto.subject, "科目"),
          priceCents: dto.priceCents,
          priceUnit: dto.priceUnit === undefined ? undefined : this.requiredText(dto.priceUnit, "计价单位"),
          settlement: dto.settlement === undefined ? undefined : this.requiredText(dto.settlement, "结算方式"),
          schedule: this.requiredText(dto.schedule, "授课时间"),
          description: this.requiredText(dto.description, "描述"),
          studentInfo: this.nullableText(dto.studentInfo),
          address: online ? null : this.nullableText(dto.address),
          capacity: dto.capacity,
          latitude,
          longitude,
          contactEncrypted: contact ? this.encrypt(contact) : null,
          status: JobStatus.PENDING
        }
      });
      if (latitude !== null && latitude !== undefined && longitude !== null && longitude !== undefined) {
        await tx.$executeRawUnsafe(
          `UPDATE job_posts SET location = ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography WHERE id = $3::uuid`,
          longitude,
          latitude,
          job.id
        );
      }
      await tx.auditLog.create({
        data: { actorId: user.id, action: "job.create", targetType: "JobPost", targetId: job.id, after: { status: job.status, type: job.type } }
      });
      return this.present(job, user.id);
    });
  }

  async update(user: RequestUser, id: string, dto: UpdateJobDto) {
    const { version } = dto;
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.jobPost.findFirst({ where: { id, ownerId: user.id } });
      if (!before) throw new NotFoundException("家教信息不存在");
      this.assertActiveRole(user, before.type);
      const district = dto.district === undefined ? before.district.trim() : this.requiredText(dto.district, "授课区域");
      const online = district === "线上";
      const province = online
        ? null
        : dto.province === undefined
          ? before.province
          : this.requiredText(dto.province, "省份");
      const city = online
        ? null
        : dto.city === undefined
          ? before.city
          : this.requiredText(dto.city, "城市");
      const address = online
        ? null
        : dto.address === undefined
          ? before.address
          : this.nullableText(dto.address);
      if (!online && (!province?.trim() || !city?.trim())) throw new BadRequestException("请选择完整省市区");
      if (!online && !address?.trim()) throw new BadRequestException("线下授课必须通过地图选择详细地点");
      const coordinatePairProvided = dto.latitude !== undefined || dto.longitude !== undefined;
      if (!online && coordinatePairProvided && (dto.latitude === undefined || dto.longitude === undefined)) {
        throw new BadRequestException("经纬度必须同时提供");
      }
      if (!online && !coordinatePairProvided && (before.latitude === null || before.longitude === null)) {
        throw new BadRequestException("线下授课必须提供完整经纬度");
      }
      const latitude = online ? null : dto.latitude;
      const longitude = online ? null : dto.longitude;
      const contact = dto.contact === undefined ? undefined : this.normalizeContact(dto.contact);
      if (before.status === JobStatus.PUBLISHED) {
        if (before.version !== version) throw new ConflictException("记录已变化，请刷新后重试");
        const pendingRevision = await tx.jobRevision.findFirst({
          where: { jobId: id, status: AuditStatus.PENDING },
          select: { id: true }
        });
        if (pendingRevision) throw new ConflictException("已有修改申请等待审核，请先等待平台处理");
        const proposedLatitude = online
          ? null
          : coordinatePairProvided
            ? dto.latitude!
            : this.numberOrNull(before.latitude);
        const proposedLongitude = online
          ? null
          : coordinatePairProvided
            ? dto.longitude!
            : this.numberOrNull(before.longitude);
        const proposedData = {
          title: dto.title === undefined ? before.title : this.requiredText(dto.title, "标题"),
          province,
          city,
          district,
          area: dto.area === undefined ? before.area : this.nullableText(dto.area),
          grade: dto.grade === undefined ? before.grade : this.requiredText(dto.grade, "年级"),
          subject: dto.subject === undefined ? before.subject : this.requiredText(dto.subject, "科目"),
          priceCents: dto.priceCents ?? before.priceCents,
          priceUnit: dto.priceUnit === undefined ? before.priceUnit : this.requiredText(dto.priceUnit, "计价单位"),
          settlement: dto.settlement === undefined ? before.settlement : this.requiredText(dto.settlement, "结算方式"),
          schedule: dto.schedule === undefined ? before.schedule : this.requiredText(dto.schedule, "授课时间"),
          description: dto.description === undefined ? before.description : this.requiredText(dto.description, "描述"),
          studentInfo: dto.studentInfo === undefined ? before.studentInfo : this.nullableText(dto.studentInfo),
          address,
          capacity: dto.capacity ?? before.capacity,
          latitude: proposedLatitude,
          longitude: proposedLongitude
        };
        const revision = await tx.jobRevision.create({
          data: {
            jobId: id,
            requesterId: user.id,
            proposedData,
            proposedContactEncrypted: contact === undefined ? null : contact ? this.encrypt(contact) : null,
            contactChanged: contact !== undefined
          }
        });
        await tx.auditLog.create({
          data: {
            actorId: user.id,
            action: "job.revision.request",
            targetType: "JobRevision",
            targetId: revision.id,
            before: { jobId: id, jobVersion: before.version },
            after: { status: revision.status, revisionVersion: revision.version }
          }
        });
        return {
          ...this.present(before, user.id),
          revisionPending: true,
          pendingRevision: revision
        };
      }
      const result = await tx.jobPost.updateMany({
        where: { id, ownerId: user.id, version, status: { in: [JobStatus.DRAFT, JobStatus.PENDING, JobStatus.REJECTED] } },
        data: {
          title: dto.title === undefined ? undefined : this.requiredText(dto.title, "标题"),
          province,
          city,
          district,
          area: dto.area === undefined ? undefined : this.nullableText(dto.area),
          grade: dto.grade === undefined ? undefined : this.requiredText(dto.grade, "年级"),
          subject: dto.subject === undefined ? undefined : this.requiredText(dto.subject, "科目"),
          priceCents: dto.priceCents,
          priceUnit: dto.priceUnit === undefined ? undefined : this.requiredText(dto.priceUnit, "计价单位"),
          settlement: dto.settlement === undefined ? undefined : this.requiredText(dto.settlement, "结算方式"),
          schedule: dto.schedule === undefined ? undefined : this.requiredText(dto.schedule, "授课时间"),
          description: dto.description === undefined ? undefined : this.requiredText(dto.description, "描述"),
          studentInfo: dto.studentInfo === undefined ? undefined : this.nullableText(dto.studentInfo),
          address,
          capacity: dto.capacity,
          latitude,
          longitude,
          contactEncrypted: contact === undefined ? undefined : contact ? this.encrypt(contact) : null,
          status: JobStatus.PENDING,
          auditNote: null,
          version: { increment: 1 }
        }
      });
      if (!result.count) throw new ConflictException("记录已变化或当前状态不可编辑，请刷新后重试");
      if (online) {
        await tx.$executeRawUnsafe(`UPDATE job_posts SET location = NULL WHERE id = $1::uuid`, id);
      } else if (latitude !== undefined && longitude !== undefined) {
        await tx.$executeRawUnsafe(
          `UPDATE job_posts SET location = ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography WHERE id = $3::uuid`,
          longitude,
          latitude,
          id
        );
      }
      const updated = await tx.jobPost.findUniqueOrThrow({ where: { id } });
      await tx.auditLog.create({
        data: {
          actorId: user.id,
          action: "job.update",
          targetType: "JobPost",
          targetId: id,
          before: { status: before.status, version: before.version },
          after: { status: updated.status, version: updated.version }
        }
      });
      return this.present(updated, user.id);
    });
  }

  async favorite(accountId: string, jobId: string) {
    await this.prisma.$transaction(async (tx) => {
      const job = await tx.jobPost.findFirst({
        where: {
          id: jobId,
          OR: [
            { status: JobStatus.PUBLISHED },
            { ownerId: accountId },
            { applications: { some: { teacherId: accountId } } }
          ]
        },
        select: { id: true }
      });
      if (!job) throw new NotFoundException("家教信息不存在");
      await tx.favorite.upsert({
        where: { accountId_jobId: { accountId, jobId } },
        update: {},
        create: { accountId, jobId }
      });
      await tx.auditLog.create({
        data: { actorId: accountId, action: "job.favorite", targetType: "JobPost", targetId: jobId, after: { favorite: true } }
      });
    });
    return { favorite: true };
  }

  async unfavorite(accountId: string, jobId: string) {
    await this.prisma.$transaction(async (tx) => {
      await tx.favorite.deleteMany({ where: { accountId, jobId } });
      await tx.auditLog.create({
        data: { actorId: accountId, action: "job.unfavorite", targetType: "JobPost", targetId: jobId, after: { favorite: false } }
      });
    });
    return { favorite: false };
  }

  async close(user: RequestUser, jobId: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(`SELECT id FROM job_posts WHERE id = $1::uuid FOR UPDATE`, jobId);
      const job = await tx.jobPost.findUnique({ where: { id: jobId } });
      if (!job) throw new NotFoundException("家教信息不存在");
      if (job.ownerId !== user.id) throw new ForbiddenException("只能关闭自己的发布");
      this.assertActiveRole(user, job.type);
      if (job.status === JobStatus.CLOSED) throw new ConflictException("该发布已经关闭");
      const pending = await tx.application.findMany({
        where: { jobId, status: ApplicationStatus.PENDING },
        select: { id: true, teacherId: true }
      });
      const handledAt = new Date();
      await tx.jobPost.update({
        where: { id: jobId },
        data: { status: JobStatus.CLOSED, version: { increment: 1 } }
      });
      await tx.application.updateMany({
        where: { jobId, status: ApplicationStatus.PENDING },
        data: {
          status: ApplicationStatus.REJECTED,
          statusNote: "发布者已关闭该信息",
          handledAt,
          version: { increment: 1 }
        }
      });
      for (const application of pending) {
        await tx.outboxEvent.create({
          data: {
            aggregateType: "Application",
            aggregateId: application.id,
            eventType: "application.rejected",
            payload: { applicationId: application.id, teacherId: application.teacherId, jobId, note: "发布者已关闭该信息" }
          }
        });
      }
      await tx.auditLog.create({
        data: {
          actorId: user.id,
          action: "job.close",
          targetType: "JobPost",
          targetId: jobId,
          before: { status: job.status, version: job.version },
          after: { status: JobStatus.CLOSED, rejectedApplications: pending.length }
        }
      });
      const updated = await tx.jobPost.findUniqueOrThrow({ where: { id: jobId } });
      return this.present(updated, user.id);
    });
  }

  async reopen(user: RequestUser, jobId: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(`SELECT id FROM job_posts WHERE id = $1::uuid FOR UPDATE`, jobId);
      const job = await tx.jobPost.findUnique({ where: { id: jobId } });
      if (!job) throw new NotFoundException("家教信息不存在");
      if (job.ownerId !== user.id) throw new ForbiddenException("只能重新开放自己的发布");
      this.assertActiveRole(user, job.type);
      if (job.status !== JobStatus.CLOSED) throw new ConflictException("只有已关闭的发布可以重新开放");
      const accepted = await tx.application.count({ where: { jobId, status: ApplicationStatus.ACCEPTED } });
      if (accepted >= job.capacity) throw new ConflictException("名额仍已满，无法重新开放");
      const updated = await tx.jobPost.update({
        where: { id: jobId },
        data: { status: JobStatus.PENDING, auditNote: null, publishedAt: null, version: { increment: 1 } }
      });
      await tx.auditLog.create({
        data: {
          actorId: user.id,
          action: "job.reopen",
          targetType: "JobPost",
          targetId: jobId,
          before: { status: job.status, version: job.version },
          after: { status: updated.status, version: updated.version }
        }
      });
      return this.present(updated, user.id);
    });
  }

  private present(job: any, accountId: string) {
    const {
      contactEncrypted: _contactEncrypted,
      favorites,
      applications,
      revisions,
      owner,
      privacyMode: rawPrivacyMode,
      ...safeJob
    } = job;
    const currentApplication = applications?.[0] || null;
    const privacyMode = owner?.preference?.privacyMode ?? rawPrivacyMode ?? true;
    const canViewPreciseLocation =
      safeJob.ownerId === accountId ||
      currentApplication?.status === ApplicationStatus.ACCEPTED ||
      privacyMode === false;
    const latitude = this.numberOrNull(safeJob.latitude);
    const longitude = this.numberOrNull(safeJob.longitude);
    const distanceMeters = safeJob.distanceMeters === undefined
      ? undefined
      : canViewPreciseLocation
        ? Number(safeJob.distanceMeters)
        : Math.max(1000, Math.ceil(Number(safeJob.distanceMeters) / 1000) * 1000);
    return {
      ...safeJob,
      price: safeJob.priceCents / 100,
      address: canViewPreciseLocation ? safeJob.address : null,
      latitude: canViewPreciseLocation ? latitude : this.approximateCoordinate(latitude),
      longitude: canViewPreciseLocation ? longitude : this.approximateCoordinate(longitude),
      ...(distanceMeters === undefined ? {} : { distanceMeters }),
      locationApproximate: !canViewPreciseLocation,
      owner: owner ? {
        id: owner.id,
        nickname: owner.nickname,
        avatarUrl: owner.avatarUrl,
        teacherProfile: owner.teacherProfile?.auditStatus === "APPROVED" ? owner.teacherProfile : null
      } : undefined,
      favorite: Boolean(favorites?.length),
      currentApplication,
      pendingRevision: revisions?.[0] || null
    };
  }

  private assertActiveRole(user: RequestUser, type: JobType) {
    const requiredRole = type === JobType.TEACHING_NEED ? RoleCode.PARENT : RoleCode.TEACHER;
    if (user.activeRole !== requiredRole) {
      throw new ForbiddenException(requiredRole === RoleCode.PARENT ? "请切换到家长角色后操作" : "请切换到老师角色后操作");
    }
  }

  private requiredText(value: string, label: string) {
    const normalized = value.trim();
    if (!normalized) throw new BadRequestException(`${label}不能为空`);
    return normalized;
  }

  private nullableText(value?: string) {
    if (value === undefined) return undefined;
    return value.trim() || null;
  }

  private normalizeContact(value?: string) {
    if (value === undefined) return undefined;
    const normalized = value.trim();
    if (normalized.length < 3 || normalized.length > 100 || !CONTACT_PATTERN.test(normalized)) {
      throw new BadRequestException("联系方式格式不正确，请填写手机号、微信号或邮箱等有效信息");
    }
    return normalized;
  }

  private numberOrNull(value: unknown) {
    return value === null || value === undefined ? null : Number(value);
  }

  private approximateCoordinate(value: number | null) {
    return value === null ? null : Math.round(value * 100) / 100;
  }

  private encrypt(value: string) {
    const key = createHash("sha256")
      .update(this.config.get("DATA_ENCRYPTION_KEY") || this.config.getOrThrow("JWT_REFRESH_SECRET"))
      .digest();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString("base64url")).join(".");
  }
}
