import { ConflictException, ForbiddenException } from "@nestjs/common";
import { AccountStatus, ApplicationStatus, JobStatus, JobType, RoleCode } from "../../generated/prisma/enums";
import { CommunicationsService, conversationContextKey } from "./communications.service";

const parent = { id: "parent-id", activeRole: RoleCode.PARENT, roles: [RoleCode.PARENT, RoleCode.TEACHER] };
const teacher = { id: "teacher-id", activeRole: RoleCode.TEACHER, roles: [RoleCode.PARENT, RoleCode.TEACHER] };
const jobId = "job-id";
const contextKey = conversationContextKey(jobId, parent.id, teacher.id);

function boundConversation(overrides: Record<string, unknown> = {}) {
  return {
    id: "conversation-id",
    jobId,
    contextKey,
    members: [
      { accountId: parent.id, role: RoleCode.PARENT, lastReadAt: null, account: { id: parent.id, nickname: "家长", avatarUrl: null } },
      { accountId: teacher.id, role: RoleCode.TEACHER, lastReadAt: null, account: { id: teacher.id, nickname: "老师", avatarUrl: null } }
    ],
    messages: [],
    ...overrides
  };
}

function setup() {
  const prisma: any = {
    notification: { findMany: jest.fn(), updateMany: jest.fn() },
    conversation: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn()
    },
    conversationMember: { updateMany: jest.fn() },
    userPreference: { findUnique: jest.fn() },
    message: { findMany: jest.fn(), findUnique: jest.fn(), count: jest.fn(), create: jest.fn() },
    jobPost: { findUnique: jest.fn(), findMany: jest.fn() },
    application: { findFirst: jest.fn(), findMany: jest.fn() },
    account: { findUnique: jest.fn() },
    $queryRawUnsafe: jest.fn(),
    $transaction: jest.fn()
  };
  prisma.$transaction.mockImplementation((callback: (tx: any) => unknown) => callback(prisma));
  return { prisma, service: new CommunicationsService(prisma) };
}

describe("CommunicationsService role-bound conversations", () => {
  it("creates a job-scoped conversation with explicit parent and teacher memberships", async () => {
    const { prisma, service } = setup();
    prisma.jobPost.findUnique.mockResolvedValue({
      id: jobId,
      ownerId: parent.id,
      type: JobType.TEACHING_NEED,
      status: JobStatus.PUBLISHED
    });
    prisma.application.findFirst.mockResolvedValue({ id: "application-id" });
    prisma.account.findUnique.mockResolvedValue({ id: teacher.id, status: AccountStatus.ACTIVE });
    prisma.conversation.upsert.mockResolvedValue(boundConversation());

    await expect(service.startConversation(parent, teacher.id, jobId)).resolves.toMatchObject({
      id: "conversation-id",
      contextKey
    });
    expect(prisma.conversation.upsert).toHaveBeenCalledWith({
      where: { contextKey },
      update: {},
      create: {
        jobId,
        contextKey,
        members: {
          create: [
            { accountId: parent.id, role: RoleCode.PARENT },
            { accountId: teacher.id, role: RoleCode.TEACHER }
          ]
        }
      },
      include: { members: true }
    });
  });

  it("uses the job in the stable context key so the same people can have independent job conversations", () => {
    expect(conversationContextKey("job-a", parent.id, teacher.id)).not.toBe(
      conversationContextKey("job-b", parent.id, teacher.id)
    );
  });

  it("lists only conversations bound to the caller's active role and removes the caller member", async () => {
    const { prisma, service } = setup();
    const malformed = boundConversation({
      id: "malformed-id",
      members: [
        { accountId: parent.id, role: RoleCode.PARENT },
        { accountId: teacher.id, role: RoleCode.PARENT }
      ]
    });
    prisma.conversation.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([boundConversation(), malformed]);
    prisma.userPreference.findUnique.mockResolvedValue({ chatNotice: true });
    prisma.message.count.mockResolvedValue(2);

    const result = await service.conversations(teacher);

    expect(prisma.conversation.findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: { members: { some: { accountId: teacher.id, role: RoleCode.TEACHER } } }
    }));
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: "conversation-id", viewerRole: RoleCode.TEACHER, unreadCount: 2 });
    expect(result[0].members).toEqual([
      expect.objectContaining({ accountId: parent.id, role: RoleCode.PARENT })
    ]);
  });

  it.each([
    ["read messages", (service: CommunicationsService) => service.messages(teacher, "conversation-id")],
    ["send a message", (service: CommunicationsService) => service.sendMessage(teacher, "conversation-id", {
      clientMessageId: "client-message-id",
      content: "hello"
    })],
    ["mark read", (service: CommunicationsService) => service.readConversation(teacher, "conversation-id")]
  ])("blocks the wrong active identity before it can %s", async (_label, invoke) => {
    const { prisma, service } = setup();
    prisma.conversation.findUnique.mockResolvedValue(boundConversation({
      members: [
        { accountId: teacher.id, role: RoleCode.PARENT },
        { accountId: parent.id, role: RoleCode.TEACHER }
      ]
    }));

    await expect(invoke(service)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.message.findMany).not.toHaveBeenCalled();
    expect(prisma.message.create).not.toHaveBeenCalled();
    expect(prisma.conversationMember.updateMany).not.toHaveBeenCalled();
  });

  it("lazily binds one unambiguous legacy conversation before returning its messages", async () => {
    const { prisma, service } = setup();
    const legacy = boundConversation({
      jobId: null,
      contextKey: null,
      members: [
        { accountId: parent.id, role: null },
        { accountId: teacher.id, role: null }
      ]
    });
    prisma.conversation.findUnique
      .mockResolvedValueOnce(legacy)
      .mockResolvedValueOnce(legacy)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(boundConversation());
    prisma.application.findMany.mockResolvedValue([{
      jobId,
      teacherId: teacher.id,
      job: { ownerId: parent.id }
    }]);
    prisma.jobPost.findMany.mockResolvedValue([]);
    prisma.conversation.update.mockResolvedValue({});
    prisma.conversationMember.updateMany.mockResolvedValue({ count: 1 });
    prisma.message.findMany.mockResolvedValue([]);

    await expect(service.messages(parent, "conversation-id")).resolves.toEqual({ items: [], nextCursor: null });
    expect(prisma.conversation.update).toHaveBeenCalledWith({
      where: { id: "conversation-id" },
      data: { jobId, contextKey }
    });
    expect(prisma.conversationMember.updateMany).toHaveBeenCalledTimes(2);
  });

  it("returns the original message when a retry uses the same normalized content", async () => {
    const { prisma, service } = setup();
    const existing = {
      id: "message-id",
      conversationId: "conversation-id",
      senderId: parent.id,
      clientMessageId: "client-message-id",
      content: "同一条消息"
    };
    prisma.conversation.findUnique.mockResolvedValue(boundConversation());
    prisma.message.findUnique.mockResolvedValue(existing);

    await expect(service.sendMessage(parent, "conversation-id", {
      clientMessageId: "client-message-id",
      content: "  同一条消息  "
    })).resolves.toBe(existing);

    expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith(
      "SELECT id FROM conversations WHERE id = $1::uuid FOR UPDATE",
      "conversation-id"
    );
    expect(prisma.message.create).not.toHaveBeenCalled();
    expect(prisma.conversation.update).not.toHaveBeenCalled();
  });

  it("returns 409 when one clientMessageId is reused for different content", async () => {
    const { prisma, service } = setup();
    prisma.conversation.findUnique.mockResolvedValue(boundConversation());
    prisma.message.findUnique.mockResolvedValue({
      id: "message-id",
      conversationId: "conversation-id",
      senderId: parent.id,
      clientMessageId: "client-message-id",
      content: "原消息"
    });

    const promise = service.sendMessage(parent, "conversation-id", {
      clientMessageId: "client-message-id",
      content: "不同的消息"
    });
    await expect(promise).rejects.toBeInstanceOf(ConflictException);
    await expect(promise).rejects.toMatchObject({
      response: expect.objectContaining({ code: "CLIENT_MESSAGE_ID_CONFLICT" })
    });
    expect(prisma.message.create).not.toHaveBeenCalled();
    expect(prisma.conversation.update).not.toHaveBeenCalled();
  });

  it("creates a new message after the idempotency check and updates conversation activity", async () => {
    const { prisma, service } = setup();
    const created = { id: "message-id", content: "新消息" };
    prisma.conversation.findUnique.mockResolvedValue(boundConversation());
    prisma.message.findUnique.mockResolvedValue(null);
    prisma.message.create.mockResolvedValue(created);
    prisma.conversation.update.mockResolvedValue({});

    await expect(service.sendMessage(parent, "conversation-id", {
      clientMessageId: "new-client-message-id",
      content: " 新消息 "
    })).resolves.toBe(created);
    expect(prisma.message.create).toHaveBeenCalledWith({
      data: {
        conversationId: "conversation-id",
        senderId: parent.id,
        clientMessageId: "new-client-message-id",
        content: "新消息"
      }
    });
    expect(prisma.conversation.update).toHaveBeenCalledTimes(1);
  });

  it("keeps an ambiguous legacy conversation hidden instead of guessing an identity", async () => {
    const { prisma, service } = setup();
    const legacy = boundConversation({
      jobId: null,
      contextKey: null,
      members: [
        { accountId: parent.id, role: null },
        { accountId: teacher.id, role: null }
      ]
    });
    prisma.conversation.findUnique.mockResolvedValue(legacy);
    prisma.application.findMany.mockResolvedValue([
      { jobId: "job-a", teacherId: teacher.id, job: { ownerId: parent.id } },
      { jobId: "job-b", teacherId: teacher.id, job: { ownerId: parent.id } }
    ]);
    prisma.jobPost.findMany.mockResolvedValue([]);

    await expect(service.messages(parent, "conversation-id")).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.conversation.update).not.toHaveBeenCalled();
    expect(prisma.message.findMany).not.toHaveBeenCalled();
  });

  it("rejects ADMIN as a chat identity", async () => {
    const { service } = setup();
    await expect(service.conversations({
      id: "admin-id",
      activeRole: RoleCode.ADMIN,
      roles: [RoleCode.ADMIN]
    })).rejects.toBeInstanceOf(ForbiddenException);
  });
});
