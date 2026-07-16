import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { RequestUser } from "../../common/interfaces/request-user";
import { AccountStatus, ApplicationStatus, JobStatus, JobType, RoleCode } from "../../generated/prisma/enums";
import { PrismaService } from "../../prisma/prisma.service";
import { SendMessageDto } from "./dto/communications.dto";

type ChatRole = typeof RoleCode.PARENT | typeof RoleCode.TEACHER;

interface ConversationContext {
  jobId: string;
  parentId: string;
  teacherId: string;
  contextKey: string;
}

interface BoundMember {
  accountId: string;
  role: RoleCode | null;
}

interface BoundConversation {
  id: string;
  jobId: string | null;
  contextKey: string | null;
  members: BoundMember[];
}

export function conversationContextKey(jobId: string, parentId: string, teacherId: string) {
  return `job:${jobId}:parent:${parentId}:teacher:${teacherId}`;
}

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

  async conversations(user: RequestUser) {
    const activeRole = this.activeChatRole(user);
    await this.repairLegacyConversations(user);

    const [conversations, preference] = await Promise.all([
      this.prisma.conversation.findMany({
        where: { members: { some: { accountId: user.id, role: activeRole } } },
        include: {
          members: {
            include: { account: { select: { id: true, nickname: true, avatarUrl: true } } }
          },
          messages: { orderBy: { createdAt: "desc" }, take: 1 }
        },
        orderBy: { updatedAt: "desc" }
      }),
      this.prisma.userPreference.findUnique({ where: { accountId: user.id }, select: { chatNotice: true } })
    ]);
    const showUnreadCount = preference?.chatNotice !== false;
    const roleBound = conversations.filter((conversation) => this.isStrictRoleBound(conversation, user.id, activeRole));
    return Promise.all(roleBound.map(async (conversation) => {
      const currentMember = conversation.members.find((member) => member.accountId === user.id);
      const unreadCount = showUnreadCount
        ? await this.prisma.message.count({
            where: {
              conversationId: conversation.id,
              senderId: { not: user.id },
              ...(currentMember?.lastReadAt ? { createdAt: { gt: currentMember.lastReadAt } } : {})
            }
          })
        : 0;
      return {
        ...conversation,
        viewerRole: activeRole,
        members: conversation.members.filter((member) => member.accountId !== user.id),
        unreadCount
      };
    }));
  }

  async startConversation(user: RequestUser, memberId: string, jobId: string) {
    const activeRole = this.activeChatRole(user);
    if (user.id === memberId) throw new ForbiddenException("不能与自己创建会话");
    const job = await this.prisma.jobPost.findUnique({
      where: { id: jobId },
      select: { id: true, ownerId: true, type: true, status: true }
    });
    if (!job) throw new NotFoundException("家教信息不存在");

    let parentId: string;
    let teacherId: string;
    if (job.type === JobType.TEACHING_NEED) {
      if (user.id === job.ownerId) {
        if (activeRole !== RoleCode.PARENT) throw new ForbiddenException("请切换到家长角色后联系老师");
        const accepted = await this.prisma.application.findFirst({
          where: { jobId, teacherId: memberId, status: { in: [ApplicationStatus.PENDING, ApplicationStatus.ACCEPTED] } },
          select: { id: true }
        });
        if (!accepted) throw new ForbiddenException("只能联系该需求的有效申请老师");
        parentId = user.id;
        teacherId = memberId;
      } else {
        if (activeRole !== RoleCode.TEACHER || memberId !== job.ownerId) {
          throw new ForbiddenException("只能联系已申请需求的发布者");
        }
        const accepted = await this.prisma.application.findFirst({
          where: { jobId, teacherId: user.id, status: { in: [ApplicationStatus.PENDING, ApplicationStatus.ACCEPTED] } },
          select: { id: true }
        });
        if (!accepted) throw new ForbiddenException("提交有效申请后才能联系发布者");
        parentId = memberId;
        teacherId = user.id;
      }
    } else {
      if (job.status !== JobStatus.PUBLISHED) throw new NotFoundException("家教信息不存在");
      if (activeRole !== RoleCode.PARENT || memberId !== job.ownerId) {
        throw new ForbiddenException("家长只能联系已发布求带信息的老师");
      }
      parentId = user.id;
      teacherId = memberId;
    }

    const member = await this.prisma.account.findUnique({ where: { id: memberId }, select: { id: true, status: true } });
    if (!member || member.status !== AccountStatus.ACTIVE) throw new NotFoundException("对方账号不存在");
    const contextKey = conversationContextKey(jobId, parentId, teacherId);
    const conversation = await this.prisma.conversation.upsert({
      where: { contextKey },
      update: {},
      create: {
        jobId,
        contextKey,
        members: {
          create: [
            { accountId: parentId, role: RoleCode.PARENT },
            { accountId: teacherId, role: RoleCode.TEACHER }
          ]
        }
      },
      include: { members: true }
    });
    if (!this.isStrictRoleBound(conversation, user.id, activeRole)) {
      throw new ForbiddenException("会话身份上下文异常，请联系平台处理");
    }
    return conversation;
  }

  async messages(user: RequestUser, conversationId: string, cursor?: string) {
    await this.assertRoleMember(user, conversationId);
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

  async sendMessage(user: RequestUser, conversationId: string, dto: SendMessageDto) {
    await this.assertRoleMember(user, conversationId);
    const content = dto.content.trim();
    if (!content) throw new BadRequestException("消息内容不能为空");
    return this.prisma.$transaction(async (tx) => {
      // Serialize idempotency checks within one conversation. A unique constraint
      // alone cannot explain whether a racing retry used the same content.
      await tx.$queryRawUnsafe(`SELECT id FROM conversations WHERE id = $1::uuid FOR UPDATE`, conversationId);
      const existing = await tx.message.findUnique({
        where: {
          conversationId_senderId_clientMessageId: {
            conversationId,
            senderId: user.id,
            clientMessageId: dto.clientMessageId
          }
        }
      });
      if (existing) {
        if (existing.content !== content) {
          throw new ConflictException({
            statusCode: 409,
            code: "CLIENT_MESSAGE_ID_CONFLICT",
            message: "clientMessageId 已用于另一条消息，请刷新后重试"
          });
        }
        return existing;
      }
      const message = await tx.message.create({
        data: { conversationId, senderId: user.id, ...dto, content }
      });
      await tx.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });
      return message;
    });
  }

  async readConversation(user: RequestUser, conversationId: string) {
    const activeRole = this.activeChatRole(user);
    await this.assertRoleMember(user, conversationId);
    const result = await this.prisma.conversationMember.updateMany({
      where: { conversationId, accountId: user.id, role: activeRole },
      data: { lastReadAt: new Date() }
    });
    if (!result.count) throw new ForbiddenException("当前身份不在该会话中");
    return { success: true };
  }

  private activeChatRole(user: RequestUser): ChatRole {
    if (
      (user.activeRole !== RoleCode.PARENT && user.activeRole !== RoleCode.TEACHER) ||
      !user.roles.includes(user.activeRole)
    ) {
      throw new ForbiddenException("请切换到家长或老师身份后使用沟通功能");
    }
    return user.activeRole;
  }

  private counterpartRole(role: ChatRole): ChatRole {
    return role === RoleCode.PARENT ? RoleCode.TEACHER : RoleCode.PARENT;
  }

  private isStrictRoleBound(conversation: BoundConversation, accountId: string, activeRole: ChatRole) {
    if (!conversation.contextKey || conversation.members.length !== 2) return false;
    const current = conversation.members.find((member) => member.accountId === accountId);
    const peer = conversation.members.find((member) => member.accountId !== accountId);
    return current?.role === activeRole && peer?.role === this.counterpartRole(activeRole);
  }

  private async assertRoleMember(user: RequestUser, conversationId: string) {
    const activeRole = this.activeChatRole(user);
    let conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: {
        id: true,
        jobId: true,
        contextKey: true,
        members: { select: { accountId: true, role: true } }
      }
    });
    if (conversation && this.isStrictRoleBound(conversation, user.id, activeRole)) return;

    const current = conversation?.members.find((member) => member.accountId === user.id);
    if (conversation && current?.role === null) {
      await this.repairLegacyConversation(user, conversation.id);
      conversation = await this.prisma.conversation.findUnique({
        where: { id: conversationId },
        select: {
          id: true,
          jobId: true,
          contextKey: true,
          members: { select: { accountId: true, role: true } }
        }
      });
      if (conversation && this.isStrictRoleBound(conversation, user.id, activeRole)) return;
    }
    throw new ForbiddenException("当前身份不在该会话中");
  }

  private async repairLegacyConversations(user: RequestUser) {
    const legacy = await this.prisma.conversation.findMany({
      where: { members: { some: { accountId: user.id, role: null } } },
      select: { id: true }
    });
    for (const conversation of legacy) await this.repairLegacyConversation(user, conversation.id);
  }

  private async repairLegacyConversation(user: RequestUser, conversationId: string) {
    const activeRole = this.activeChatRole(user);
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: {
        id: true,
        jobId: true,
        contextKey: true,
        members: { select: { accountId: true, role: true } }
      }
    });
    if (!conversation || conversation.members.length !== 2) return false;
    const current = conversation.members.find((member) => member.accountId === user.id);
    const peer = conversation.members.find((member) => member.accountId !== user.id);
    if (!current || !peer || current.role !== null) return false;

    const contexts = (await this.deriveHistoricalContexts(current.accountId, peer.accountId)).filter((context) =>
      conversation.members.every((member) => {
        const derivedRole = member.accountId === context.parentId ? RoleCode.PARENT : RoleCode.TEACHER;
        return member.role === null || member.role === derivedRole;
      })
    );
    if (contexts.length !== 1) return false;
    const context = contexts[0];
    const currentRole = context.parentId === user.id ? RoleCode.PARENT : RoleCode.TEACHER;
    if (currentRole !== activeRole) return false;

    const conflicting = await this.prisma.conversation.findUnique({
      where: { contextKey: context.contextKey },
      select: { id: true }
    });
    if (conflicting && conflicting.id !== conversation.id) return false;

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.conversation.update({
          where: { id: conversation.id },
          data: { jobId: context.jobId, contextKey: context.contextKey }
        });
        await tx.conversationMember.updateMany({
          where: { conversationId: conversation.id, accountId: context.parentId, role: null },
          data: { role: RoleCode.PARENT }
        });
        await tx.conversationMember.updateMany({
          where: { conversationId: conversation.id, accountId: context.teacherId, role: null },
          data: { role: RoleCode.TEACHER }
        });
      });
      return true;
    } catch {
      // A concurrent repair/new conversation may win the unique context key.
      // In that case the legacy row remains hidden instead of crossing identities.
      return false;
    }
  }

  private async deriveHistoricalContexts(firstId: string, secondId: string): Promise<ConversationContext[]> {
    const [applications, offers] = await Promise.all([
      this.prisma.application.findMany({
        where: {
          AND: [
            {
              OR: [
                { teacherId: firstId, job: { ownerId: secondId, type: JobType.TEACHING_NEED } },
                { teacherId: secondId, job: { ownerId: firstId, type: JobType.TEACHING_NEED } }
              ]
            },
            {
              OR: [
                { status: ApplicationStatus.ACCEPTED },
                { appointment: { isNot: null } }
              ]
            }
          ]
        },
        select: { jobId: true, teacherId: true, job: { select: { ownerId: true } } }
      }),
      this.prisma.jobPost.findMany({
        where: {
          ownerId: { in: [firstId, secondId] },
          type: JobType.TEACHER_OFFER,
          status: { in: [JobStatus.PUBLISHED, JobStatus.CLOSED] }
        },
        select: { id: true, ownerId: true }
      })
    ]);

    const contexts = new Map<string, ConversationContext>();
    for (const application of applications) {
      const context: ConversationContext = {
        jobId: application.jobId,
        parentId: application.job.ownerId,
        teacherId: application.teacherId,
        contextKey: conversationContextKey(application.jobId, application.job.ownerId, application.teacherId)
      };
      contexts.set(context.contextKey, context);
    }
    for (const offer of offers) {
      const parentId = offer.ownerId === firstId ? secondId : firstId;
      const context: ConversationContext = {
        jobId: offer.id,
        parentId,
        teacherId: offer.ownerId,
        contextKey: conversationContextKey(offer.id, parentId, offer.ownerId)
      };
      contexts.set(context.contextKey, context);
    }
    return [...contexts.values()];
  }
}
