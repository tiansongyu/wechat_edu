import { createHash } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { RequestUser } from "../../common/interfaces/request-user";
import {
  AccountStatus,
  ApplicationStatus,
  AppointmentStatus,
  AuditStatus,
  ReviewStatus,
  RoleCode
} from "../../generated/prisma/enums";
import { PrismaService } from "../../prisma/prisma.service";
import { CreateReviewDto } from "./dto/reviews.dto";

const REVIEW_ALGORITHM_VERSION = "review-v1";

export const REVIEW_TAGS: Record<"PARENT" | "TEACHER", readonly string[]> = {
  PARENT: ["专业耐心", "表达清楚", "准时守约", "沟通顺畅", "认真负责"],
  TEACHER: ["需求清晰", "沟通顺畅", "准时守约", "尊重老师", "配合积极"]
};

const PRIVATE_CONTENT_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /(?:\+?86)?1[3-9]\d{9}/, label: "手机号" },
  { pattern: /\b0\d{2,3}\d{7,8}\b/, label: "电话号码" },
  { pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i, label: "邮箱" },
  {
    pattern: /(?:微信|wechat|weixin|wx|vx)(?:号|id)?[a-z][a-z0-9]{5,19}/i,
    label: "微信号"
  },
  { pattern: /(?:qq|扣扣)(?:号)?[1-9]\d{4,11}/i, label: "QQ号" },
  { pattern: /(?<!\d)\d{17}[\dXx](?!\d)/, label: "身份证号" },
  { pattern: /(?:https?:\/\/|www\.)\S+/i, label: "网址" },
  { pattern: /\b(?:[a-z0-9-]+\.)+(?:com|cn|net|org|top|xyz|me|io)\b/i, label: "网址" },
  { pattern: /(?:家庭住址|详细地址|身份证地址)/, label: "详细住址" },
  { pattern: /(?:路|街|道|巷|弄).{0,12}\d+(?:号|栋|室)/, label: "详细住址" }
];

type NormalizedReview = {
  rating: number;
  tags: string[];
  content: string | null;
  requestHash: string;
};

type ReviewVisibility = "PUBLIC_TEACHER" | "SELF_FULL" | "APPOINTMENT_PARTICIPANT_SUMMARY";
type ReviewPartyRole = typeof RoleCode.PARENT | typeof RoleCode.TEACHER;

@Injectable()
export class ReviewsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(user: RequestUser, appointmentId: string, idempotencyKey: string, dto: CreateReviewDto) {
    const key = idempotencyKey?.trim();
    if (!key || key.length > 128) {
      throw new BadRequestException("缺少有效的 Idempotency-Key 请求头");
    }

    const normalized = this.normalizeReview(user.activeRole, dto);
    const scope = `review:${appointmentId}`;
    const cached = await this.prisma.idempotencyRecord.findUnique({
      where: { actorId_scope_key: { actorId: user.id, scope, key } }
    });
    if (cached && cached.expiresAt > new Date()) {
      this.assertCachedRole(cached.response, user.activeRole);
      this.assertMatchingRequest(cached.requestHash, normalized.requestHash);
      return cached.response;
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(`SELECT id FROM appointments WHERE id = $1::uuid FOR UPDATE`, appointmentId);

      const existingKey = await tx.idempotencyRecord.findUnique({
        where: { actorId_scope_key: { actorId: user.id, scope, key } }
      });
      if (existingKey?.expiresAt && existingKey.expiresAt > new Date()) {
        this.assertCachedRole(existingKey.response, user.activeRole);
        this.assertMatchingRequest(existingKey.requestHash, normalized.requestHash);
        return existingKey.response;
      }
      if (existingKey) await tx.idempotencyRecord.delete({ where: { id: existingKey.id } });

      const appointment = await tx.appointment.findUnique({
        where: { id: appointmentId }
      });
      if (!appointment) throw new NotFoundException("预约不存在");
      const job = await tx.jobPost.findUnique({ where: { id: appointment.jobId } });
      const application = await tx.application.findUnique({ where: { id: appointment.applicationId } });
      if (!job || !application) throw new NotFoundException("预约关联信息不存在");
      const appointmentContext = { ...appointment, job, application };
      const identities = this.resolveReviewParties(user, appointmentContext);
      if (
        appointment.status !== AppointmentStatus.COMPLETED ||
        !appointment.parentCompletedAt ||
        !appointment.teacherCompletedAt ||
        !appointment.completedAt
      ) {
        throw new ConflictException("只有双方确认完成且无争议的预约可以评价");
      }
      if (application.status !== ApplicationStatus.ACCEPTED) {
        throw new ConflictException("预约对应的合作关系当前不可评价");
      }

      this.assertAllowedTags(identities.reviewerRole, normalized.tags);
      const existingReview = await tx.review.findUnique({
        where: { appointmentId_reviewerId: { appointmentId, reviewerId: user.id } },
        select: { id: true }
      });
      if (existingReview) throw new ConflictException("你已经评价过本次合作");

      const review = await tx.review.create({
        data: {
          appointmentId,
          reviewerId: user.id,
          revieweeId: identities.revieweeId,
          reviewerRole: identities.reviewerRole,
          revieweeRole: identities.revieweeRole,
          rating: normalized.rating,
          tags: normalized.tags,
          content: normalized.content,
          status: ReviewStatus.PUBLISHED
        }
      });
      const response = this.presentOwnReview(review);

      await tx.outboxEvent.create({
        data: {
          aggregateType: "Review",
          aggregateId: review.id,
          eventType: "review.created",
          payload: {
            reviewId: review.id,
            appointmentId,
            reviewerId: user.id,
            revieweeId: identities.revieweeId,
            reviewerRole: identities.reviewerRole,
            revieweeRole: identities.revieweeRole
          }
        }
      });
      await tx.auditLog.create({
        data: {
          actorId: user.id,
          action: "review.create",
          targetType: "Review",
          targetId: review.id,
          after: {
            appointmentId,
            revieweeId: identities.revieweeId,
            reviewerRole: identities.reviewerRole,
            revieweeRole: identities.revieweeRole,
            rating: normalized.rating,
            tags: normalized.tags,
            contentLength: normalized.content ? Array.from(normalized.content).length : 0
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

  async listForAccount(
    accountId: string,
    revieweeRole: RoleCode | undefined,
    cursor?: string,
    limit = 20
  ) {
    if (!revieweeRole) throw new BadRequestException("请明确指定评价身份 role=TEACHER");
    if (revieweeRole === RoleCode.PARENT) throw new NotFoundException("评价记录不存在");
    if (revieweeRole !== RoleCode.TEACHER) throw new BadRequestException("评价身份只能是老师");
    return this.listTeacherReviews(accountId, cursor, limit);
  }

  async listTeacherReviews(teacherId: string, cursor?: string, limit = 20) {
    const account = await this.prisma.account.findUnique({
      where: { id: teacherId },
      select: {
        id: true,
        status: true,
        roles: {
          where: { roleCode: RoleCode.TEACHER },
          select: { roleCode: true }
        },
        teacherProfile: { select: { auditStatus: true } }
      }
    });
    if (
      !account ||
      account.status !== AccountStatus.ACTIVE ||
      !account.roles.length ||
      account.teacherProfile?.auditStatus !== AuditStatus.APPROVED
    ) {
      throw this.reviewProfileNotFound();
    }
    return this.listRoleReviews(teacherId, RoleCode.TEACHER, "PUBLIC_TEACHER", cursor, limit);
  }

  async listReceivedReviews(user: RequestUser, cursor?: string, limit = 20) {
    if (
      (user.activeRole !== RoleCode.PARENT && user.activeRole !== RoleCode.TEACHER) ||
      !user.roles.includes(user.activeRole)
    ) {
      throw new ForbiddenException("当前身份不能查看收到的评价");
    }
    return this.listRoleReviews(user.id, user.activeRole, "SELF_FULL", cursor, limit);
  }

  async getCounterpartReputation(user: RequestUser, appointmentId: string) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      select: {
        status: true,
        job: { select: { ownerId: true } },
        application: { select: { teacherId: true, status: true } }
      }
    });
    if (!appointment) throw this.appointmentNotFound();

    const isParent = appointment.job.ownerId === user.id;
    const isTeacher = appointment.application.teacherId === user.id;
    if (!isParent && !isTeacher) throw this.appointmentNotFound();

    const requiredRole = isParent ? RoleCode.PARENT : RoleCode.TEACHER;
    if (user.activeRole !== requiredRole || !user.roles.includes(requiredRole)) {
      throw new ForbiddenException({
        statusCode: 403,
        code: "ROLE_SWITCH_REQUIRED",
        message: "请切换到该预约对应的身份后查看对方评价",
        requiredRole
      });
    }
    if (
      appointment.status === AppointmentStatus.CANCELLED ||
      appointment.application.status !== ApplicationStatus.ACCEPTED
    ) {
      throw new ForbiddenException({
        statusCode: 403,
        code: "REPUTATION_CONTEXT_UNAVAILABLE",
        message: "当前预约状态不能查看对方评价"
      });
    }

    const targetRole = isParent ? RoleCode.TEACHER : RoleCode.PARENT;
    const targetId = isParent ? appointment.application.teacherId : appointment.job.ownerId;
    const summaryPromise = this.loadRoleSummary(targetId, targetRole);

    if (targetRole === RoleCode.TEACHER) {
      return {
        visibility: "APPOINTMENT_PARTICIPANT_SUMMARY" as ReviewVisibility,
        targetRole,
        summary: await summaryPromise
      };
    }

    const [summary, ownReview] = await Promise.all([
      summaryPromise,
      this.prisma.review.findFirst({
        where: {
          appointmentId,
          reviewerId: user.id,
          revieweeId: targetId,
          reviewerRole: RoleCode.TEACHER,
          revieweeRole: RoleCode.PARENT
        },
        select: {
          id: true,
          reviewerRole: true,
          revieweeRole: true,
          rating: true,
          tags: true,
          content: true,
          status: true,
          createdAt: true
        }
      })
    ]);
    return {
      visibility: "APPOINTMENT_PARTICIPANT_SUMMARY" as ReviewVisibility,
      targetRole,
      summary,
      myReview: ownReview ? this.presentContextOwnReview(ownReview) : null
    };
  }

  private async listRoleReviews(
    accountId: string,
    revieweeRole: ReviewPartyRole,
    visibility: Exclude<ReviewVisibility, "APPOINTMENT_PARTICIPANT_SUMMARY">,
    cursor?: string,
    limit = 20
  ) {
    const where = this.roleReviewWhere(accountId, revieweeRole);
    if (cursor) {
      const validCursor = await this.prisma.review.findFirst({ where: { ...where, id: cursor }, select: { id: true } });
      if (!validCursor) throw new BadRequestException("评价游标无效或不属于当前评价列表");
    }
    const [reviews, grouped] = await Promise.all([
      this.prisma.review.findMany({
        where,
        select: {
          id: true,
          reviewerRole: true,
          revieweeRole: true,
          rating: true,
          tags: true,
          content: true,
          createdAt: true
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {})
      }),
      this.prisma.review.groupBy({
        by: ["rating"],
        where,
        _count: { _all: true }
      })
    ]);

    const hasMore = reviews.length > limit;
    const page = hasMore ? reviews.slice(0, limit) : reviews;
    return {
      visibility,
      targetRole: revieweeRole,
      items: page.map((review) => ({
        id: review.id,
        reviewerRole: review.reviewerRole,
        reviewerLabel: review.reviewerRole === RoleCode.PARENT ? "本次合作家长" : "本次合作老师",
        revieweeRole: review.revieweeRole,
        rating: review.rating,
        tags: review.tags,
        content: review.content,
        createdAt: review.createdAt
      })),
      nextCursor: hasMore ? page[page.length - 1].id : null,
      summary: this.buildSummary(grouped)
    };
  }

  private async loadRoleSummary(accountId: string, revieweeRole: ReviewPartyRole) {
    const grouped = await this.prisma.review.groupBy({
      by: ["rating"],
      where: this.roleReviewWhere(accountId, revieweeRole),
      _count: { _all: true }
    });
    return this.buildSummary(grouped);
  }

  private roleReviewWhere(accountId: string, revieweeRole: ReviewPartyRole) {
    return {
      revieweeId: accountId,
      revieweeRole,
      reviewerRole: this.oppositeRole(revieweeRole),
      status: ReviewStatus.PUBLISHED,
      appointment: { status: AppointmentStatus.COMPLETED }
    } as const;
  }

  private oppositeRole(role: ReviewPartyRole) {
    return role === RoleCode.TEACHER ? RoleCode.PARENT : RoleCode.TEACHER;
  }

  private buildSummary(grouped: Array<{ rating: number; _count: { _all: number } }>) {
    const distribution: Record<1 | 2 | 3 | 4 | 5, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let weightedTotal = 0;
    let count = 0;
    for (const group of grouped) {
      if (group.rating >= 1 && group.rating <= 5) {
        const rating = group.rating as 1 | 2 | 3 | 4 | 5;
        distribution[rating] = group._count._all;
        count += group._count._all;
        weightedTotal += rating * group._count._all;
      }
    }
    const average = count ? Number((weightedTotal / count).toFixed(2)) : null;
    const level = this.reputationLevel(count, average);
    return {
      displayAverage: count >= 3 ? average : null,
      count,
      distribution,
      level: level.code,
      levelLabel: level.label,
      algorithmVersion: REVIEW_ALGORITHM_VERSION
    };
  }

  private normalizeReview(activeRole: RoleCode, dto: CreateReviewDto): NormalizedReview {
    if (activeRole !== RoleCode.PARENT && activeRole !== RoleCode.TEACHER) {
      throw new ForbiddenException("请切换到本次合作使用的身份后评价");
    }
    if (!Number.isInteger(dto.rating) || dto.rating < 1 || dto.rating > 5) {
      throw new BadRequestException("评分必须是1到5的整数");
    }

    const tags = Array.from(new Set((dto.tags || []).map((tag) => tag.trim()).filter(Boolean)));
    if (tags.length > 5) throw new BadRequestException("评价标签最多选择5个");
    const content = dto.content?.trim().normalize("NFKC") || null;
    if (content && Array.from(content).length > 500) throw new BadRequestException("评价内容不能超过500字");
    if (dto.rating <= 2 && (!content || Array.from(content.replace(/\s/g, "")).length < 10)) {
      throw new BadRequestException("1至2星评价请填写不少于10字的具体说明");
    }
    if (content) this.assertNoPrivateContent(content);

    const canonicalPayload = JSON.stringify({
      rating: dto.rating,
      tags: [...tags].sort((left, right) => left.localeCompare(right, "zh-CN")),
      content
    });
    return {
      rating: dto.rating,
      tags,
      content,
      requestHash: createHash("sha256").update(canonicalPayload).digest("hex")
    };
  }

  private resolveReviewParties(user: RequestUser, appointment: any) {
    if (appointment.job.ownerId === user.id) {
      if (user.activeRole !== RoleCode.PARENT) {
        throw new ForbiddenException("请切换到家长身份后评价本次合作");
      }
      return {
        reviewerRole: RoleCode.PARENT,
        revieweeRole: RoleCode.TEACHER,
        revieweeId: appointment.application.teacherId as string
      };
    }
    if (appointment.application.teacherId === user.id) {
      if (user.activeRole !== RoleCode.TEACHER) {
        throw new ForbiddenException("请切换到老师身份后评价本次合作");
      }
      return {
        reviewerRole: RoleCode.TEACHER,
        revieweeRole: RoleCode.PARENT,
        revieweeId: appointment.job.ownerId as string
      };
    }
    throw new ForbiddenException("只有本次预约的合作双方可以评价");
  }

  private assertMatchingRequest(storedHash: string | null, requestHash: string) {
    if (!storedHash || storedHash !== requestHash) {
      throw new ConflictException("Idempotency-Key 已用于不同的评价内容");
    }
  }

  private assertCachedRole(response: unknown, activeRole: RoleCode) {
    const reviewerRole = typeof response === "object" && response !== null
      ? (response as { reviewerRole?: unknown }).reviewerRole
      : undefined;
    if (reviewerRole !== activeRole) throw new ForbiddenException("请切换到本次合作使用的身份后评价");
  }

  private assertAllowedTags(reviewerRole: RoleCode, tags: string[]) {
    const allowedTags = reviewerRole === RoleCode.PARENT ? REVIEW_TAGS.PARENT : REVIEW_TAGS.TEACHER;
    const invalidTag = tags.find((tag) => !allowedTags.includes(tag));
    if (invalidTag) throw new BadRequestException(`当前身份不能使用评价标签：${invalidTag}`);
  }

  private assertNoPrivateContent(content: string) {
    const digitMap: Record<string, string> = {
      "〇": "0", "零": "0", "一": "1", "二": "2", "三": "3",
      "四": "4", "五": "5", "六": "6", "七": "7", "八": "8", "九": "9"
    };
    const normalizedProbe = content
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[〇零一二三四五六七八九]/g, (character) => digitMap[character]);
    const compactProbe = normalizedProbe.replace(/[\s._·•\-—_:：，,]/g, "");
    const matched = PRIVATE_CONTENT_PATTERNS.find(
      ({ pattern }) => pattern.test(normalizedProbe) || pattern.test(compactProbe)
    );
    if (matched) throw new BadRequestException(`评价中不能包含${matched.label}等联系方式或隐私信息`);
  }

  private reviewProfileNotFound() {
    return new NotFoundException({
      statusCode: 404,
      code: "REVIEW_PROFILE_NOT_FOUND",
      message: "评价资料不存在"
    });
  }

  private appointmentNotFound() {
    return new NotFoundException({
      statusCode: 404,
      code: "APPOINTMENT_NOT_FOUND",
      message: "预约不存在"
    });
  }

  private presentContextOwnReview(review: any) {
    return {
      id: review.id,
      reviewerRole: review.reviewerRole,
      revieweeRole: review.revieweeRole,
      rating: review.rating,
      tags: review.tags,
      content: review.content,
      status: review.status,
      createdAt: review.createdAt instanceof Date ? review.createdAt.toISOString() : review.createdAt
    };
  }

  private presentOwnReview(review: any) {
    return {
      id: review.id,
      appointmentId: review.appointmentId,
      reviewerRole: review.reviewerRole,
      revieweeRole: review.revieweeRole,
      rating: review.rating,
      tags: review.tags,
      content: review.content,
      status: review.status,
      createdAt: review.createdAt instanceof Date ? review.createdAt.toISOString() : review.createdAt
    };
  }

  private reputationLevel(count: number, average: number | null) {
    if (count < 3 || average === null) return { code: "NEW", label: "评价积累中" };
    if (average >= 4.8) return { code: "EXCELLENT", label: "卓越" };
    if (average >= 4.5) return { code: "VERY_GOOD", label: "优秀" };
    if (average >= 4) return { code: "GOOD", label: "良好" };
    if (average >= 3) return { code: "FAIR", label: "一般" };
    return { code: "NEEDS_IMPROVEMENT", label: "待提升" };
  }
}
