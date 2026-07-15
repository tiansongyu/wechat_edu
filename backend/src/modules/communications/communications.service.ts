import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { SendMessageDto } from "./dto/communications.dto";

@Injectable()
export class CommunicationsService {
  constructor(private readonly prisma: PrismaService) {}

  notifications(accountId: string) {
    return this.prisma.notification.findMany({
      where: { accountId },
      orderBy: { createdAt: "desc" },
      take: 100
    });
  }

  async readAllNotifications(accountId: string) {
    const result = await this.prisma.notification.updateMany({
      where: { accountId, readAt: null },
      data: { readAt: new Date() }
    });
    return { updated: result.count };
  }

  async readNotification(accountId: string, id: string) {
    const result = await this.prisma.notification.updateMany({
      where: { id, accountId },
      data: { readAt: new Date() }
    });
    if (!result.count) throw new NotFoundException("通知不存在");
    return { success: true };
  }

  conversations(accountId: string) {
    return this.prisma.conversation.findMany({
      where: { members: { some: { accountId } } },
      include: {
        members: {
          where: { accountId: { not: accountId } },
          include: { account: { select: { id: true, nickname: true, avatarUrl: true } } }
        },
        messages: { orderBy: { createdAt: "desc" }, take: 1 }
      },
      orderBy: { updatedAt: "desc" }
    });
  }

  async startConversation(accountId: string, memberId: string) {
    if (accountId === memberId) throw new ForbiddenException("不能与自己创建会话");
    const member = await this.prisma.account.findUnique({ where: { id: memberId } });
    if (!member) throw new NotFoundException("对方账号不存在");
    const existing = await this.prisma.conversation.findFirst({
      where: {
        AND: [
          { members: { some: { accountId } } },
          { members: { some: { accountId: memberId } } }
        ]
      },
      include: { members: true }
    });
    if (existing && existing.members.length === 2) return existing;
    return this.prisma.conversation.create({
      data: { members: { create: [{ accountId }, { accountId: memberId }] } },
      include: { members: true }
    });
  }

  async messages(accountId: string, conversationId: string, cursor?: string) {
    await this.assertMember(accountId, conversationId);
    const items = await this.prisma.message.findMany({
      where: { conversationId },
      include: { sender: { select: { id: true, nickname: true, avatarUrl: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 51,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {})
    });
    const hasMore = items.length > 50;
    const page = hasMore ? items.slice(0, 50) : items;
    return { items: page, nextCursor: hasMore ? page[page.length - 1].id : null };
  }

  async sendMessage(accountId: string, conversationId: string, dto: SendMessageDto) {
    await this.assertMember(accountId, conversationId);
    const message = await this.prisma.message.upsert({
      where: {
        conversationId_senderId_clientMessageId: {
          conversationId,
          senderId: accountId,
          clientMessageId: dto.clientMessageId
        }
      },
      update: {},
      create: { conversationId, senderId: accountId, ...dto }
    });
    await this.prisma.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });
    return message;
  }

  private async assertMember(accountId: string, conversationId: string) {
    const member = await this.prisma.conversationMember.findUnique({
      where: { conversationId_accountId: { conversationId, accountId } }
    });
    if (!member) throw new ForbiddenException("你不在该会话中");
  }
}
