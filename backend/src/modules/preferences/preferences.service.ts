import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { UpdatePreferencesDto } from "./dto/preferences.dto";

@Injectable()
export class PreferencesService {
  constructor(private readonly prisma: PrismaService) {}

  get(accountId: string) {
    return this.prisma.userPreference.upsert({
      where: { accountId },
      update: {},
      create: { accountId }
    });
  }

  update(accountId: string, dto: UpdatePreferencesDto) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.userPreference.findUnique({ where: { accountId } });
      const updated = await tx.userPreference.upsert({
        where: { accountId },
        update: dto,
        create: { accountId, ...dto }
      });
      await tx.auditLog.create({
        data: {
          actorId: accountId,
          action: "preferences.update",
          targetType: "UserPreference",
          targetId: accountId,
          before: before ? { jobNotice: before.jobNotice, chatNotice: before.chatNotice, privacyMode: before.privacyMode } : undefined,
          after: { jobNotice: updated.jobNotice, chatNotice: updated.chatNotice, privacyMode: updated.privacyMode }
        }
      });
      return updated;
    });
  }
}
