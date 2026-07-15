import { BadRequestException, ConflictException, Injectable } from "@nestjs/common";
import { AuditStatus } from "../../generated/prisma/enums";
import { PrismaService } from "../../prisma/prisma.service";
import { FilesService } from "../files/files.service";
import { AddCertificationDto, UpdateParentProfileDto, UpdateTeacherProfileDto } from "./dto/profile.dto";

@Injectable()
export class ProfilesService {
  constructor(private readonly prisma: PrismaService, private readonly files: FilesService) {}

  getTeacher(accountId: string) {
    return this.prisma.teacherProfile.findUniqueOrThrow({
      where: { accountId },
      include: { account: { select: { nickname: true, avatarUrl: true } }, certifications: true }
    });
  }

  async updateTeacher(accountId: string, dto: UpdateTeacherProfileDto) {
    const { version, ...data } = dto;
    await this.prisma.$transaction(async (tx) => {
      const current = await tx.teacherProfile.findUnique({ where: { accountId } });
      if (!current || current.version !== version) throw new ConflictException("资料已被修改，请刷新后重试");
      const merged = { ...current, ...data };
      const complete = Boolean(
        merged.realName?.trim() &&
        merged.school?.trim() &&
        merged.education?.trim() &&
        merged.subjects.length
      );
      const result = await tx.teacherProfile.updateMany({
        where: { accountId, version },
        data: {
          ...data,
          auditStatus: AuditStatus.PENDING,
          auditNote: null,
          submittedAt: complete ? new Date() : null,
          version: { increment: 1 }
        }
      });
      if (!result.count) throw new ConflictException("资料已被修改，请刷新后重试");
      await tx.auditLog.create({
        data: {
          actorId: accountId,
          action: "teacher.profile.update",
          targetType: "TeacherProfile",
          targetId: accountId,
          before: { auditStatus: current.auditStatus, version: current.version },
          after: { auditStatus: AuditStatus.PENDING, version: current.version + 1, submitted: complete }
        }
      });
    });
    return this.getTeacher(accountId);
  }

  async addCertification(accountId: string, dto: AddCertificationDto) {
    if (!dto.objectKey && !dto.fileUrl) throw new BadRequestException("请提供已上传文件的 objectKey");
    if (dto.objectKey && !dto.objectKey.startsWith(`private/${accountId}/`)) {
      throw new BadRequestException("不能使用其他账号上传的文件");
    }
    const objectKey = dto.objectKey || this.files.resolveLegacyObjectKey(accountId, dto.fileUrl!);
    const verifiedObject = await this.files.assertCertificationObject(accountId, objectKey);
    return this.prisma.$transaction(async (tx) => {
      const profile = await tx.teacherProfile.findUniqueOrThrow({ where: { accountId } });
      const complete = Boolean(
        profile.realName?.trim() &&
        profile.school?.trim() &&
        profile.education?.trim() &&
        profile.subjects.length
      );
      const certification = await tx.teacherCertification.create({
        data: {
          teacherId: accountId,
          type: dto.type,
          objectKey,
          fileUrl: null
        }
      });
      await tx.teacherProfile.update({
        where: { accountId },
        data: {
          auditStatus: AuditStatus.PENDING,
          auditNote: null,
          submittedAt: complete ? new Date() : null,
          version: { increment: 1 }
        }
      });
      await tx.auditLog.create({
        data: {
          actorId: accountId,
          action: "teacher.certification.add",
          targetType: "TeacherCertification",
          targetId: certification.id,
          after: {
            type: certification.type,
            auditStatus: certification.auditStatus,
            profileSubmitted: complete,
            storageValidation: { mode: dto.objectKey ? "object-key" : "legacy-url-resolved", ...verifiedObject }
          }
        }
      });
      return certification;
    });
  }

  updateParent(accountId: string, dto: UpdateParentProfileDto) {
    const coordinatePairProvided = dto.latitude !== undefined || dto.longitude !== undefined;
    if (coordinatePairProvided && (dto.latitude === undefined || dto.longitude === undefined)) {
      throw new BadRequestException("经纬度必须同时提供");
    }
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.parentProfile.findUnique({ where: { accountId } });
      const updated = await tx.parentProfile.upsert({
        where: { accountId },
        update: dto,
        create: { accountId, ...dto }
      });
      await tx.auditLog.create({
        data: {
          actorId: accountId,
          action: "parent.profile.update",
          targetType: "ParentProfile",
          targetId: accountId,
          before: before ? {
            province: before.province,
            city: before.city,
            district: before.district,
            address: before.address
          } : undefined,
          after: {
            province: updated.province,
            city: updated.city,
            district: updated.district,
            address: updated.address,
            hasCoordinates: updated.latitude !== null && updated.longitude !== null
          }
        }
      });
      return updated;
    });
  }
}
