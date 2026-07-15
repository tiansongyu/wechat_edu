import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { RequestUser } from "../../common/interfaces/request-user";
import { AccountStatus, ApplicationStatus, JobStatus, JobType, RoleCode } from "../../generated/prisma/enums";
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

  async conversations(accountId: string) {
    const [conversations, preference] = await Promise.all([
      this.prisma.conversation.findMany({
        where: { members: { some: { accountId } } },
        include: {
          members: {
            include: { account: { select: { id: true, nickname: true, avatarUrl: true } } }
          },
          messages: { orderBy: { createdAt: "desc" }, take: 1 }
        },
        orderBy: { updatedAt: "desc" }
      }),
      this.prisma.userPreference.findUnique({ where: { accountId }, select: { chatNotice: true } })
    ]);
    const showUnreadCount = preference?.chatNotice !== false;
    return Promise.all(conversations.map(async (conversation) => {
      const currentMember = conversation.members.find((member) => member.accountId === accountId);
      const unreadCount = showUnreadCount
        ? await this.prisma.message.count({
            where: {
              conversationId: conversation.id,
              senderId: { not: accountId },
              ...(currentMember?.lastReadAt ? { createdAt: { gt: currentMember.lastReadAt } } : {})
            }
          })
        : 0;
      return {
        ...conversation,
        members: conversation.members.filter((member) => member.accountId !== accountId),
        unreadCount
      };
    }));
  }

  async startConversation(user: RequestUser, memberId: string, jobId: string) {
    if (user.id === memberId) throw new ForbiddenException("不能与自己创建会话");
    const job = await this.prisma.jobPost.findUnique({
      where: { id: jobId },
      select: { id: true, ownerId: true, type: true, status: true }
    });
    if (!job) throw new NotFoundException("家教信息不存在");

    if (job.type === JobType.TEACHING_NEED) {
      if (user.id === job.ownerId) {
        if (user.activeRole !== RoleCode.PARENT) throw new ForbiddenException("请切换到家长角色后联系老师");
        const accepted = await this.prisma.application.findFirst({
          where: { jobId, teacherId: memberId, status: ApplicationStatus.ACCEPTED },
          select: { id: true }
        });
        if (!accepted) throw new ForbiddenException("只能联系该需求已录用的老师");
      } else {
        if (user.activeRole !== RoleCode.TEACHER || memberId !== job.ownerId) {
          throw new ForbiddenException("只能联系已录用需求的发布者");
        }
        const accepted = await this.prisma.application.findFirst({
          where: { jobId, teacherId: user.id, status: ApplicationStatus.ACCEPTED },
          select: { id: true }
        });
        if (!accepted) throw new ForbiddenException("报名被录用后才能联系发布者");
      }
    } else {
      if (job.status !== JobStatus.PUBLISHED) throw new NotFoundException("家教信息不存在");
      if (user.activeRole !== RoleCode.PARENT || memberId !== job.ownerId) {
        throw new ForbiddenException("家长只能联系已发布求带信息的老师");
      }
    }

    const member = await this.prisma.account.findUnique({ where: { id: memberId }, select: { id: true, status: true } });
    if (!member || member.status !== AccountStatus.ACTIVE) throw new NotFoundException("对方账号不存在");
    const existing = await this.prisma.conversation.findFirst({
      where: {
        AND: [
          { members: { some: { accountId: user.id } } },
          { members: { some: { accountId: memberId } } }
        ]
      },
      include: { members: true }
    });
    if (existing && existing.members.length === 2) return existing;
    return this.prisma.conversation.create({
      data: { members: { create: [{ accountId: user.id }, { accountId: memberId }] } },
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
    const content = dto.content.trim();
    if (!content) throw new BadRequestException("消息内容不能为空");
    return this.prisma.$transaction(async (tx) => {
      const message = await tx.message.upsert({
        where: {
          conversationId_senderId_clientMessageId: {
            conversationId,
            senderId: accountId,
            clientMessageId: dto.clientMessageId
          }
        },
        update: {},
        create: { conversationId, senderId: accountId, ...dto, content }
      });
      await tx.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });
      return message;
    });
  }

  async readConversation(accountId: string, conversationId: string) {
    const result = await this.prisma.conversationMember.updateMany({
      where: { conversationId, accountId },
      data: { lastReadAt: new Date() }
    });
    if (!result.count) throw new ForbiddenException("你不在该会话中");
    return { success: true };
  }

  private async assertMember(accountId: string, conversationId: string) {
    const member = await this.prisma.conversationMember.findUnique({
      where: { conversationId_accountId: { conversationId, accountId } }
    });
    if (!member) throw new ForbiddenException("你不在该会话中");
  }
}
