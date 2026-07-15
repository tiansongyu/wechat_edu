import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JobStatus, JobType, RoleCode } from "../../generated/prisma/enums";
import { RequestUser } from "../../common/interfaces/request-user";
import { PrismaService } from "../../prisma/prisma.service";
import { CreateJobDto, ListJobsDto, NearbyJobsDto, UpdateJobDto } from "./dto/jobs.dto";

@Injectable()
export class JobsService {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  async list(query: ListJobsDto, accountId: string) {
    const limit = query.limit || 20;
    const jobs = await this.prisma.jobPost.findMany({
      where: {
        status: JobStatus.PUBLISHED,
        type: query.type,
        district: query.district,
        grade: query.grade,
        subject: query.subject,
        ...(query.keyword ? {
          OR: [
            { title: { contains: query.keyword, mode: "insensitive" as const } },
            { description: { contains: query.keyword, mode: "insensitive" as const } },
            { area: { contains: query.keyword, mode: "insensitive" as const } }
          ]
        } : {})
      },
      include: {
        owner: { select: { id: true, nickname: true, avatarUrl: true } },
        favorites: { where: { accountId }, select: { accountId: true } }
      },
      orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {})
    });
    const hasMore = jobs.length > limit;
    const items = hasMore ? jobs.slice(0, limit) : jobs;
    return {
      items: items.map((job) => this.present(job)),
      nextCursor: hasMore ? items[items.length - 1].id : null
    };
  }

  async nearby(query: NearbyJobsDto) {
    const radius = query.radiusKm * 1000;
    const typeFilter = query.type ? `AND "type" = '${query.type}'::"JobType"` : "";
    const districtFilter = query.district ? `AND "district" = $4` : "";
    const values: any[] = [query.longitude, query.latitude, radius];
    if (query.district) values.push(query.district);
    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT id, title, district, area, grade, subject, "priceCents", "priceUnit", settlement,
              schedule, description, address, "publishedAt", latitude, longitude,
              ST_Distance(location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) AS "distanceMeters"
       FROM job_posts
       WHERE status = 'PUBLISHED'::"JobStatus"
         AND location IS NOT NULL
         AND ST_DWithin(location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)
         ${typeFilter} ${districtFilter}
       ORDER BY "distanceMeters" ASC
       LIMIT 50`,
      ...values
    );
    return { items: rows.map((row) => ({ ...row, price: row.priceCents / 100, distanceMeters: Number(row.distanceMeters) })) };
  }

  async detail(id: string, accountId: string) {
    const job = await this.prisma.jobPost.findUnique({
      where: { id },
      include: {
        owner: { select: { id: true, nickname: true, avatarUrl: true } },
        favorites: { where: { accountId }, select: { accountId: true } }
      }
    });
    if (!job) throw new NotFoundException("家教信息不存在");
    return this.present(job);
  }

  mine(ownerId: string) {
    return this.prisma.jobPost.findMany({ where: { ownerId }, orderBy: { createdAt: "desc" } });
  }

  async create(user: RequestUser, dto: CreateJobDto) {
    if (dto.type === JobType.TEACHING_NEED && !user.roles.includes(RoleCode.PARENT)) {
      throw new ForbiddenException("只有家长角色可以发布家教需求");
    }
    if (dto.type === JobType.TEACHER_OFFER && !user.roles.includes(RoleCode.TEACHER)) {
      throw new ForbiddenException("只有老师角色可以发布求带信息");
    }
    if ((dto.latitude === undefined) !== (dto.longitude === undefined)) {
      throw new BadRequestException("经纬度必须同时提供");
    }
    const { contact, latitude, longitude, ...data } = dto;
    const job = await this.prisma.jobPost.create({
      data: {
        ...data,
        ownerId: user.id,
        latitude,
        longitude,
        contactEncrypted: contact ? this.encrypt(contact) : null,
        status: JobStatus.PENDING
      }
    });
    if (latitude !== undefined && longitude !== undefined) {
      await this.prisma.$executeRawUnsafe(
        `UPDATE job_posts SET location = ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography WHERE id = $3::uuid`,
        longitude,
        latitude,
        job.id
      );
    }
    return job;
  }

  async update(ownerId: string, id: string, dto: UpdateJobDto) {
    const { version, ...data } = dto;
    const result = await this.prisma.jobPost.updateMany({
      where: { id, ownerId, version, status: { in: [JobStatus.DRAFT, JobStatus.PENDING, JobStatus.REJECTED] } },
      data: { ...data, status: JobStatus.PENDING, auditNote: null, version: { increment: 1 } }
    });
    if (!result.count) throw new ConflictException("记录已变化或当前状态不可编辑，请刷新后重试");
    return this.prisma.jobPost.findUniqueOrThrow({ where: { id } });
  }

  async favorite(accountId: string, jobId: string) {
    await this.prisma.favorite.upsert({
      where: { accountId_jobId: { accountId, jobId } },
      update: {},
      create: { accountId, jobId }
    });
    return { favorite: true };
  }

  async unfavorite(accountId: string, jobId: string) {
    await this.prisma.favorite.deleteMany({ where: { accountId, jobId } });
    return { favorite: false };
  }

  private present(job: any) {
    return {
      ...job,
      price: job.priceCents / 100,
      latitude: job.latitude === null ? null : Number(job.latitude),
      longitude: job.longitude === null ? null : Number(job.longitude),
      favorite: Boolean(job.favorites?.length),
      favorites: undefined
    };
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
