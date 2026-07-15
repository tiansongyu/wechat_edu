import { ConflictException, Injectable } from "@nestjs/common";
import { AuditStatus } from "../../generated/prisma/enums";
import { PrismaService } from "../../prisma/prisma.service";
import { AddCertificationDto, UpdateParentProfileDto, UpdateTeacherProfileDto } from "./dto/profile.dto";

@Injectable()
export class ProfilesService {
  constructor(private readonly prisma: PrismaService) {}

  getTeacher(accountId: string) {
    return this.prisma.teacherProfile.findUniqueOrThrow({
      where: { accountId },
      include: { account: { select: { nickname: true, avatarUrl: true } }, certifications: true }
    });
  }

  async updateTeacher(accountId: string, dto: UpdateTeacherProfileDto) {
    const { version, ...data } = dto;
    const result = await this.prisma.teacherProfile.updateMany({
      where: { accountId, version },
      data: { ...data, auditStatus: AuditStatus.PENDING, auditNote: null, version: { increment: 1 } }
    });
    if (!result.count) throw new ConflictException("资料已被修改，请刷新后重试");
    return this.getTeacher(accountId);
  }

  addCertification(accountId: string, dto: AddCertificationDto) {
    return this.prisma.teacherCertification.create({ data: { teacherId: accountId, ...dto } });
  }

  updateParent(accountId: string, dto: UpdateParentProfileDto) {
    return this.prisma.parentProfile.upsert({
      where: { accountId },
      update: dto,
      create: { accountId, ...dto }
    });
  }
}
