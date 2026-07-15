import { createHash } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { RequestUser } from "../../common/interfaces/request-user";
import {
  ReviewReportCategory,
  ReviewReportStatus,
  ReviewStatus,
  RoleCode
} from "../../generated/prisma/enums";
import { PrismaService } from "../../prisma/prisma.service";
import {
  AdminReviewListDto,
  AdminReviewReportListDto,
  ChangeReviewVisibilityDto,
  CreateReviewReportDto,
  ResolveReviewReportDto
} from "./dto/review-governance.dto";

const USER_REPORT_SELECT = {
  id: true,
  reviewId: true,
  category: true,
  description: true,
  status: true,
  resolutionNote: true,
  resolvedAt: true,
  createdAt: true
} as const;

const ADMIN_REVIEW_SELECT = {
  id: true,
  appointmentId: true,
  reviewerRole: true,
  revieweeRole: true,
  rating: true,
  tags: true,
  content: true,
  status: true,
  version: true,
  statusChangedReason: true,
  statusChangedAt: true,
  createdAt: true,
  reviewer: { select: { id: true, nickname: true } },
  reviewee: { select: { id: true, nickname: true } }
} as const;

const ADMIN_REPORT_SELECT = {
  id: true,
  reviewId: true,
  reporterRole: true,
  category: true,
  description: true,
  status: true,
  version: true,
  resolutionNote: true,
  resolvedAt: true,
  createdAt: true,
  reporter: { select: { id: true, nickname: true } },
  review: {
    select: {
      rating: true,
      tags: true,
      content: true,
      status: true,
      version: true,
      revieweeRole: true,
      reviewer: { select: { nickname: true } },
      reviewee: { select: { nickname: true } }
    }
  }
} as const;

type NormalizedReport = {
  category: ReviewReportCategory;
  description: string;
  requestHash: string;
};

@Injectable()
export class ReviewGovernanceService {
  constructor(private readonly prisma: PrismaService) {}

  async createReport(
    user: RequestUser,
    reviewId: string,
    idempotencyKey: string,
    dto: CreateReviewReportDto
  ) {
    const key = this.normalizeIdempotencyKey(idempotencyKey);
    const normalized = this.normalizeReport(user.activeRole, dto);

    const scope = `review-report:${reviewId}`;
    const cached = await this.prisma.idempotencyRecord.findUnique({
      where: { actorId_scope_key: { actorId: user.id, scope, key } }
    });
    if (cached && cached.expiresAt > new Date()) {
      this.assertMatchingRequest(cached.requestHash, normalized.requestHash);
      return cached.response;
    }
    await this.assertReportableReview(this.prisma, user, reviewId);

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(`SELECT id FROM reviews WHERE id = $1::uuid FOR UPDATE`, reviewId);
      await this.assertReportableReview(tx, user, reviewId);

      const existingKey = await tx.idempotencyRecord.findUnique({
        where: { actorId_scope_key: { actorId: user.id, scope, key } }
      });
      if (existingKey?.expiresAt && existingKey.expiresAt > new Date()) {
        this.assertMatchingRequest(existingKey.requestHash, normalized.requestHash);
        return existingKey.response;
      }
      if (existingKey) await tx.idempotencyRecord.delete({ where: { id: existingKey.id } });

      const existingReport = await tx.reviewReport.findUnique({
        where: { reviewId_reporterId: { reviewId, reporterId: user.id } },
        select: { id: true }
      });
      if (existingReport) throw new ConflictException("你已经举报过该评价");

      const report = await tx.reviewReport.create({
        data: {
          reviewId,
          reporterId: user.id,
          reporterRole: user.activeRole,
          category: normalized.category,
          description: normalized.description,
          status: ReviewReportStatus.OPEN
        },
        select: USER_REPORT_SELECT
      });
      const response = this.presentUserReport(report, false);

      await tx.auditLog.create({
        data: {
          actorId: user.id,
          action: "review_report.create",
          targetType: "ReviewReport",
          targetId: report.id,
          after: {
            reviewId,
            reporterRole: user.activeRole,
            category: normalized.category,
            descriptionLength: Array.from(normalized.description).length,
            status: ReviewReportStatus.OPEN
          }
        }
      });
      await tx.outboxEvent.create({
        data: {
          aggregateType: "ReviewReport",
          aggregateId: report.id,
          eventType: "review.reported",
          payload: {
            reportId: report.id,
            reviewId,
            category: normalized.category,
            reporterRole: user.activeRole
          }
        }
      });
      await tx.idempotencyRecord.create({
        data: {
          actorId: user.id,
          scope,
          key,
          requestHash: normalized.requestHash,
          response,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
        }
      });
      return response;
    });
  }

  async listMyReports(user: RequestUser, cursor?: string, limit = 20) {
    const where = { reporterId: user.id, reporterRole: user.activeRole };
    if (cursor) {
      const validCursor = await this.prisma.reviewReport.findFirst({
        where: { ...where, id: cursor },
        select: { id: true }
      });
      if (!validCursor) throw new BadRequestException("举报游标无效或不属于当前身份");
    }

    const reports = await this.prisma.reviewReport.findMany({
      where,
      select: USER_REPORT_SELECT,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {})
    });
    const hasMore = reports.length > limit;
    const page = hasMore ? reports.slice(0, limit) : reports;
    return {
      items: page.map((report) => this.presentUserReport(report, true)),
      nextCursor: hasMore ? page[page.length - 1].id : null
    };
  }

  async listAdminReviews(query: AdminReviewListDto) {
    const filters: any[] = [];
    if (query.status) filters.push({ status: query.status });
    if (query.rating) filters.push({ rating: query.rating });
    if (query.keyword) {
      filters.push({
        OR: [
          { content: { contains: query.keyword, mode: "insensitive" } },
          { reviewer: { nickname: { contains: query.keyword, mode: "insensitive" } } },
          { reviewee: { nickname: { contains: query.keyword, mode: "insensitive" } } }
        ]
      });
    }
    const where = filters.length ? { AND: filters } : {};
    const [items, total] = await Promise.all([
      this.prisma.review.findMany({
        where,
        select: ADMIN_REVIEW_SELECT,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize
      }),
      this.prisma.review.count({ where })
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  hideReview(actorId: string, reviewId: string, dto: ChangeReviewVisibilityDto) {
    return this.changeReviewVisibility(actorId, reviewId, ReviewStatus.PUBLISHED, ReviewStatus.HIDDEN, dto);
  }

  restoreReview(actorId: string, reviewId: string, dto: ChangeReviewVisibilityDto) {
    return this.changeReviewVisibility(actorId, reviewId, ReviewStatus.HIDDEN, ReviewStatus.PUBLISHED, dto);
  }

  async listAdminReports(query: AdminReviewReportListDto) {
    const filters: any[] = [];
    if (query.status) filters.push({ status: query.status });
    if (query.category) filters.push({ category: query.category });
    if (query.keyword) {
      filters.push({
        OR: [
          { description: { contains: query.keyword, mode: "insensitive" } },
          { resolutionNote: { contains: query.keyword, mode: "insensitive" } },
          { reporter: { nickname: { contains: query.keyword, mode: "insensitive" } } },
          { review: { content: { contains: query.keyword, mode: "insensitive" } } }
        ]
      });
    }
    const where = filters.length ? { AND: filters } : {};
    const [items, total] = await Promise.all([
      this.prisma.reviewReport.findMany({
        where,
        select: ADMIN_REPORT_SELECT,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize
      }),
      this.prisma.reviewReport.count({ where })
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async resolveReport(actorId: string, reportId: string, dto: ResolveReviewReportDto) {
    const note = this.normalizeModerationText(dto.note, "处理说明");
    if (
      dto.resolution !== ReviewReportStatus.ACTION_TAKEN &&
      dto.resolution !== ReviewReportStatus.NO_VIOLATION
    ) {
      throw new BadRequestException("举报处理结果无效");
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(`SELECT id FROM review_reports WHERE id = $1::uuid FOR UPDATE`, reportId);
      const report = await tx.reviewReport.findUnique({
        where: { id: reportId },
        select: {
          id: true,
          reviewId: true,
          status: true,
          version: true,
          category: true
        }
      });
      if (!report) throw new NotFoundException("举报记录不存在");
      await tx.$queryRawUnsafe(`SELECT id FROM reviews WHERE id = $1::uuid FOR UPDATE`, report.reviewId);
      const review = await tx.review.findUnique({
        where: { id: report.reviewId },
        select: { id: true, status: true, version: true }
      });
      if (!review) throw new NotFoundException("评价不存在");
      this.assertVersion(dto.version, report.version, "举报记录");
      this.assertVersion(dto.reviewVersion, review.version, "评价");
      if (report.status !== ReviewReportStatus.OPEN) {
        throw new ConflictException("该举报已经处理，不能重复结案");
      }

      let reviewChanged = false;
      if (dto.resolution === ReviewReportStatus.ACTION_TAKEN) {
        if (review.status === ReviewStatus.REMOVED) {
          throw new ConflictException("评价已被永久移除，不能再执行隐藏操作");
        }
        if (review.status === ReviewStatus.PUBLISHED) {
          const hidden = await tx.review.updateMany({
            where: {
              id: report.reviewId,
              version: dto.reviewVersion,
              status: ReviewStatus.PUBLISHED
            },
            data: {
              status: ReviewStatus.HIDDEN,
              version: { increment: 1 },
              statusChangedReason: note,
              statusChangedAt: new Date(),
              statusChangedById: actorId
            }
          });
          if (hidden.count !== 1) throw this.versionConflict("评价", review.version);
          reviewChanged = true;
        }
      }

      const resolvedAt = new Date();
      const resolved = await tx.reviewReport.updateMany({
        where: { id: reportId, version: dto.version, status: ReviewReportStatus.OPEN },
        data: {
          status: dto.resolution,
          resolutionNote: note,
          resolvedAt,
          resolvedById: actorId,
          version: { increment: 1 }
        }
      });
      if (resolved.count !== 1) throw this.versionConflict("举报记录", report.version);

      if (reviewChanged) {
        await tx.auditLog.create({
          data: {
            actorId,
            action: "review.hide_from_report",
            targetType: "Review",
            targetId: report.reviewId,
            before: { status: review.status, version: review.version },
            after: {
              status: ReviewStatus.HIDDEN,
              version: review.version + 1,
              reason: note,
              sourceReportId: reportId
            }
          }
        });
        await tx.outboxEvent.create({
          data: {
            aggregateType: "Review",
            aggregateId: report.reviewId,
            eventType: "review.hidden",
            payload: { reviewId: report.reviewId, reportId, reason: note }
          }
        });
      }
      await tx.auditLog.create({
        data: {
          actorId,
          action: "review_report.resolve",
          targetType: "ReviewReport",
          targetId: reportId,
          before: { status: report.status, version: report.version },
          after: {
            status: dto.resolution,
            version: report.version + 1,
            note,
            reviewVersion: review.version + (reviewChanged ? 1 : 0)
          }
        }
      });
      await tx.outboxEvent.create({
        data: {
          aggregateType: "ReviewReport",
          aggregateId: reportId,
          eventType: "review_report.resolved",
          payload: {
            reportId,
            reviewId: report.reviewId,
            resolution: dto.resolution,
            reviewHidden: reviewChanged || review.status === ReviewStatus.HIDDEN
          }
        }
      });

    });
    return this.prisma.reviewReport.findUniqueOrThrow({ where: { id: reportId }, select: ADMIN_REPORT_SELECT });
  }

  private async changeReviewVisibility(
    actorId: string,
    reviewId: string,
    from: ReviewStatus,
    to: ReviewStatus,
    dto: ChangeReviewVisibilityDto
  ) {
    const reason = this.normalizeModerationText(dto.reason, to === ReviewStatus.HIDDEN ? "隐藏原因" : "恢复原因");
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(`SELECT id FROM reviews WHERE id = $1::uuid FOR UPDATE`, reviewId);
      const review = await tx.review.findUnique({
        where: { id: reviewId },
        select: { id: true, status: true, version: true, statusChangedReason: true, statusChangedAt: true }
      });
      if (!review) throw new NotFoundException("评价不存在");
      this.assertVersion(dto.version, review.version, "评价");
      if (review.status !== from) {
        const action = to === ReviewStatus.HIDDEN ? "隐藏" : "恢复";
        throw new ConflictException(`当前评价状态不能执行${action}操作`);
      }

      const changedAt = new Date();
      const updated = await tx.review.updateMany({
        where: { id: reviewId, status: from, version: dto.version },
        data: {
          status: to,
          version: { increment: 1 },
          statusChangedReason: reason,
          statusChangedAt: changedAt,
          statusChangedById: actorId
        }
      });
      if (updated.count !== 1) throw this.versionConflict("评价", review.version);

      const action = to === ReviewStatus.HIDDEN ? "hide" : "restore";
      await tx.auditLog.create({
        data: {
          actorId,
          action: `review.${action}`,
          targetType: "Review",
          targetId: reviewId,
          before: {
            status: review.status,
            version: review.version,
            statusChangedReason: review.statusChangedReason,
            statusChangedAt: review.statusChangedAt
          },
          after: { status: to, version: review.version + 1, reason, statusChangedAt: changedAt }
        }
      });
      await tx.outboxEvent.create({
        data: {
          aggregateType: "Review",
          aggregateId: reviewId,
          eventType: `review.${to === ReviewStatus.HIDDEN ? "hidden" : "restored"}`,
          payload: { reviewId, reason, version: review.version + 1 }
        }
      });
    });
    return this.prisma.review.findUniqueOrThrow({ where: { id: reviewId }, select: ADMIN_REVIEW_SELECT });
  }

  private async assertReportableReview(client: any, user: RequestUser, reviewId: string) {
    const review = await client.review.findFirst({
      where: {
        id: reviewId,
        revieweeId: user.id,
        revieweeRole: user.activeRole,
        status: { not: ReviewStatus.REMOVED }
      },
      select: { id: true }
    });
    if (!review) throw this.reviewNotFound();
  }

  private normalizeReport(activeRole: RoleCode, dto: CreateReviewReportDto): NormalizedReport {
    if (activeRole !== RoleCode.PARENT && activeRole !== RoleCode.TEACHER) throw this.reviewNotFound();
    if (!Object.values(ReviewReportCategory).includes(dto.category)) {
      throw new BadRequestException("举报分类无效");
    }
    const description = this.normalizeModerationText(dto.description, "举报说明");
    const canonical = JSON.stringify({ activeRole, category: dto.category, description });
    return {
      category: dto.category,
      description,
      requestHash: createHash("sha256").update(canonical).digest("hex")
    };
  }

  private normalizeModerationText(value: string, label: string) {
    const normalized = typeof value === "string" ? value.trim().normalize("NFKC") : "";
    const length = Array.from(normalized).length;
    if (length < 10 || length > 500) throw new BadRequestException(`${label}须为10至500字`);
    return normalized;
  }

  private normalizeIdempotencyKey(value: string) {
    const key = value?.trim();
    if (!key || key.length > 128) throw new BadRequestException("缺少有效的 Idempotency-Key 请求头");
    return key;
  }

  private assertMatchingRequest(storedHash: string | null, requestHash: string) {
    if (!storedHash || storedHash !== requestHash) {
      throw new ConflictException("Idempotency-Key 已用于不同的举报内容");
    }
  }

  private assertVersion(expected: number, actual: number, target: string) {
    if (!Number.isInteger(expected) || expected !== actual) throw this.versionConflict(target, actual);
  }

  private versionConflict(target: string, currentVersion: number) {
    return new ConflictException({
      statusCode: 409,
      code: "VERSION_CONFLICT",
      message: `${target}已发生变化，请刷新后重试`,
      currentVersion
    });
  }

  private reviewNotFound() {
    return new NotFoundException({
      statusCode: 404,
      code: "REVIEW_NOT_FOUND",
      message: "评价不存在"
    });
  }

  private presentUserReport(report: any, includeResolution: boolean) {
    if (includeResolution) {
      return {
        id: report.id as string,
        reviewId: report.reviewId as string,
        category: report.category as ReviewReportCategory,
        status: report.status as ReviewReportStatus,
        description: report.description as string,
        createdAt: this.iso(report.createdAt),
        resolutionNote: (report.resolutionNote as string | null) || null,
        resolvedAt: report.resolvedAt ? this.iso(report.resolvedAt) : null
      };
    }
    return {
      id: report.id as string,
      reviewId: report.reviewId as string,
      category: report.category as ReviewReportCategory,
      status: report.status as ReviewReportStatus,
      description: report.description as string,
      createdAt: this.iso(report.createdAt)
    };
  }

  private iso(value: Date | string) {
    return value instanceof Date ? value.toISOString() : value;
  }
}
