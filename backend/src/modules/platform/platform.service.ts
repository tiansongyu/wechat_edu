import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import {
  AccountStatus,
  ApplicationStatus,
  AppointmentStatus,
  AuditStatus,
  JobStatus,
  ReviewStatus,
  RoleCode
} from "../../generated/prisma/enums";
import { PrismaService } from "../../prisma/prisma.service";

const PUBLIC_SETTING_KEY = "platform.public";

interface PlatformPublicSetting {
  brand: {
    name: string;
    slogan: string;
  };
  trustHighlights: string[];
}

@Injectable()
export class PlatformService {
  constructor(private readonly prisma: PrismaService) {}

  async overview() {
    const record = await this.prisma.systemSetting.findUnique({
      where: { key: PUBLIC_SETTING_KEY },
      select: { value: true }
    });
    const publicSetting = this.parsePublicSetting(record?.value);

    const [approvedTeachers, publishedJobs, completedAppointments, publishedReviews] = await Promise.all([
      this.prisma.teacherProfile.count({
        where: {
          auditStatus: AuditStatus.APPROVED,
          account: {
            status: AccountStatus.ACTIVE,
            roles: { some: { roleCode: RoleCode.TEACHER } }
          }
        }
      }),
      this.prisma.jobPost.count({
        where: {
          status: JobStatus.PUBLISHED,
          owner: { status: AccountStatus.ACTIVE }
        }
      }),
      this.prisma.appointment.count({
        where: {
          status: AppointmentStatus.COMPLETED,
          parentCompletedAt: { not: null },
          teacherCompletedAt: { not: null },
          completedAt: { not: null },
          job: { owner: { status: AccountStatus.ACTIVE } },
          application: {
            status: ApplicationStatus.ACCEPTED,
            teacher: { status: AccountStatus.ACTIVE }
          }
        }
      }),
      this.prisma.review.count({
        where: {
          status: ReviewStatus.PUBLISHED,
          OR: [
            { reviewerRole: RoleCode.PARENT, revieweeRole: RoleCode.TEACHER },
            { reviewerRole: RoleCode.TEACHER, revieweeRole: RoleCode.PARENT }
          ],
          appointment: {
            status: AppointmentStatus.COMPLETED,
            parentCompletedAt: { not: null },
            teacherCompletedAt: { not: null },
            completedAt: { not: null },
            application: { status: ApplicationStatus.ACCEPTED }
          },
          reviewer: { status: AccountStatus.ACTIVE },
          reviewee: { status: AccountStatus.ACTIVE }
        }
      })
    ]);

    return {
      brand: publicSetting.brand,
      trustHighlights: publicSetting.trustHighlights,
      metrics: {
        approvedTeachers,
        publishedJobs,
        completedAppointments,
        publishedReviews
      }
    };
  }

  private parsePublicSetting(value: unknown): PlatformPublicSetting {
    if (!this.isRecord(value) || !this.isRecord(value.brand)) {
      throw this.configurationUnavailable();
    }

    const name = this.readText(value.brand.name, 40);
    const slogan = this.readText(value.brand.slogan, 120);
    if (!Array.isArray(value.trustHighlights) || value.trustHighlights.length < 1 || value.trustHighlights.length > 6) {
      throw this.configurationUnavailable();
    }
    const trustHighlights = value.trustHighlights.map((item) => this.readText(item, 80));

    return { brand: { name, slogan }, trustHighlights };
  }

  private readText(value: unknown, maxLength: number) {
    if (typeof value !== "string") throw this.configurationUnavailable();
    const normalized = value.trim();
    if (!normalized || normalized.length > maxLength) throw this.configurationUnavailable();
    return normalized;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  private configurationUnavailable() {
    return new ServiceUnavailableException("平台公开配置暂不可用，请稍后重试");
  }
}
