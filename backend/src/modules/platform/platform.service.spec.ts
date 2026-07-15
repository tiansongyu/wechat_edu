import { ServiceUnavailableException } from "@nestjs/common";
import {
  AccountStatus,
  ApplicationStatus,
  AppointmentStatus,
  AuditStatus,
  JobStatus,
  ReviewStatus,
  RoleCode
} from "../../generated/prisma/enums";
import { PlatformService } from "./platform.service";

const publicSetting = {
  brand: {
    name: " 家教直聘 ",
    slogan: " 认真匹配每一次教与学 ",
    internalColor: "secret"
  },
  trustHighlights: [" 教师资料经平台审核 ", "真实合作才能评价", "隐私信息分级保护"],
  internalExperiment: { enabled: true }
};

function serviceWith(setting: unknown = publicSetting, counts = [0, 0, 0, 0]) {
  const prisma = {
    systemSetting: {
      findUnique: jest.fn().mockResolvedValue(setting === null ? null : { value: setting })
    },
    teacherProfile: { count: jest.fn().mockResolvedValue(counts[0]) },
    jobPost: { count: jest.fn().mockResolvedValue(counts[1]) },
    appointment: { count: jest.fn().mockResolvedValue(counts[2]) },
    review: { count: jest.fn().mockResolvedValue(counts[3]) }
  };
  return { service: new PlatformService(prisma as never), prisma };
}

describe("PlatformService", () => {
  it("returns real zero metrics and only whitelisted public configuration fields", async () => {
    const { service, prisma } = serviceWith();

    await expect(service.overview()).resolves.toEqual({
      brand: { name: "家教直聘", slogan: "认真匹配每一次教与学" },
      trustHighlights: ["教师资料经平台审核", "真实合作才能评价", "隐私信息分级保护"],
      metrics: { approvedTeachers: 0, publishedJobs: 0, completedAppointments: 0, publishedReviews: 0 }
    });
    expect(prisma.systemSetting.findUnique).toHaveBeenCalledWith({
      where: { key: "platform.public" },
      select: { value: true }
    });
  });

  it("returns a service error instead of fabricated copy when the setting is missing", async () => {
    const { service, prisma } = serviceWith(null);

    await expect(service.overview()).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(prisma.teacherProfile.count).not.toHaveBeenCalled();
  });

  it.each([
    ["non-object value", []],
    ["missing brand", { trustHighlights: ["真实合作"] }],
    ["empty brand name", { brand: { name: " ", slogan: "可靠匹配" }, trustHighlights: ["真实合作"] }],
    ["non-string highlight", { brand: { name: "家教直聘", slogan: "可靠匹配" }, trustHighlights: [1] }],
    ["empty highlight list", { brand: { name: "家教直聘", slogan: "可靠匹配" }, trustHighlights: [] }]
  ])("rejects malformed public configuration: %s", async (_label, value) => {
    const { service } = serviceWith(value);
    await expect(service.overview()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it("filters every public metric by persisted status and account availability", async () => {
    const { service, prisma } = serviceWith(publicSetting, [12, 8, 3, 21]);

    await expect(service.overview()).resolves.toMatchObject({
      metrics: { approvedTeachers: 12, publishedJobs: 8, completedAppointments: 3, publishedReviews: 21 }
    });
    expect(prisma.teacherProfile.count).toHaveBeenCalledWith({
      where: {
        auditStatus: AuditStatus.APPROVED,
        account: {
          status: AccountStatus.ACTIVE,
          roles: { some: { roleCode: RoleCode.TEACHER } }
        }
      }
    });
    expect(prisma.jobPost.count).toHaveBeenCalledWith({
      where: { status: JobStatus.PUBLISHED, owner: { status: AccountStatus.ACTIVE } }
    });
    expect(prisma.appointment.count).toHaveBeenCalledWith({
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
    });
    expect(prisma.review.count).toHaveBeenCalledWith({
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
    });
  });
});
