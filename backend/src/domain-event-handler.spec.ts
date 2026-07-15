import { NotificationType, ReviewReportStatus } from "./generated/prisma/enums";
import {
  appointmentNotificationRecipients,
  processDomainEventNotifications
} from "./domain-event-handler";

const eventId = "018f1ef0-0000-7000-8000-000000009001";
const ownerId = "018f1ef0-0000-7000-8000-000000009002";
const teacherId = "018f1ef0-0000-7000-8000-000000009003";
const adminId = "018f1ef0-0000-7000-8000-000000009004";

function setup() {
  const prisma: any = {
    userPreference: { findUnique: jest.fn().mockResolvedValue({ jobNotice: true }) },
    notification: { upsert: jest.fn().mockResolvedValue({}) },
    review: { findUnique: jest.fn() },
    reviewReport: { findUnique: jest.fn() }
  };
  return prisma;
}

function appointmentEvent(actorId: string) {
  return {
    id: eventId,
    aggregateType: "Appointment",
    eventType: "appointment.cancelled",
    payload: {
      appointmentId: "appointment-id",
      jobId: "job-id",
      ownerId,
      teacherId,
      actorId,
      reason: "平台处理完成"
    }
  };
}

describe("domain event notification handler", () => {
  it("targets the counterparty for participant actions and both parties for an admin action", () => {
    expect(appointmentNotificationRecipients({ ownerId, teacherId, actorId: ownerId })).toEqual([teacherId]);
    expect(appointmentNotificationRecipients({ ownerId, teacherId, actorId: teacherId })).toEqual([ownerId]);
    expect(appointmentNotificationRecipients({ ownerId, teacherId, actorId: adminId })).toEqual([ownerId, teacherId]);
  });

  it("delivers an admin appointment event to both parties with per-recipient idempotency", async () => {
    const prisma = setup();
    prisma.userPreference.findUnique.mockResolvedValue({ jobNotice: false });

    await expect(processDomainEventNotifications(prisma, appointmentEvent(adminId))).resolves.toBe(2);

    expect(prisma.notification.upsert).toHaveBeenCalledTimes(2);
    expect(prisma.notification.upsert).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: { accountId_sourceEventId: { accountId: ownerId, sourceEventId: eventId } },
      create: expect.objectContaining({ accountId: ownerId, sourceEventId: eventId })
    }));
    expect(prisma.notification.upsert).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: { accountId_sourceEventId: { accountId: teacherId, sourceEventId: eventId } },
      create: expect.objectContaining({ accountId: teacherId, sourceEventId: eventId })
    }));

    await processDomainEventNotifications(prisma, appointmentEvent(adminId));
    expect(prisma.notification.upsert.mock.calls.slice(2).map(([input]: any[]) => input.where)).toEqual([
      { accountId_sourceEventId: { accountId: ownerId, sourceEventId: eventId } },
      { accountId_sourceEventId: { accountId: teacherId, sourceEventId: eventId } }
    ]);
  });

  it("sends a participant appointment event only to the other participant", async () => {
    const prisma = setup();

    await expect(processDomainEventNotifications(prisma, appointmentEvent(ownerId))).resolves.toBe(1);

    expect(prisma.notification.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ accountId: teacherId })
    }));
  });

  it("handles report acknowledgement, visibility changes and resolution without leaking the reporter", async () => {
    const prisma = setup();
    prisma.reviewReport.findUnique.mockResolvedValue({ reporterId: ownerId });
    prisma.review.findUnique.mockResolvedValue({ reviewerId: teacherId });

    await processDomainEventNotifications(prisma, {
      id: "018f1ef0-0000-7000-8000-000000009011",
      aggregateType: "ReviewReport",
      eventType: "review.reported",
      payload: { reportId: "report-id", reviewId: "review-id", reporterRole: "PARENT" }
    });
    await processDomainEventNotifications(prisma, {
      id: "018f1ef0-0000-7000-8000-000000009012",
      aggregateType: "Review",
      eventType: "review.hidden",
      payload: {
        reviewId: "review-id",
        reportId: "report-id",
        reason: "举报人提交的隐私说明不得转发"
      }
    });
    await processDomainEventNotifications(prisma, {
      id: "018f1ef0-0000-7000-8000-000000009013",
      aggregateType: "Review",
      eventType: "review.restored",
      payload: { reviewId: "review-id", reason: "后台复核说明" }
    });
    await processDomainEventNotifications(prisma, {
      id: "018f1ef0-0000-7000-8000-000000009014",
      aggregateType: "ReviewReport",
      eventType: "review_report.resolved",
      payload: { reportId: "report-id", reviewId: "review-id", resolution: ReviewReportStatus.ACTION_TAKEN }
    });

    const creates = prisma.notification.upsert.mock.calls.map(([input]: any[]) => input.create);
    expect(creates.map((create: any) => create.accountId)).toEqual([ownerId, teacherId, teacherId, ownerId]);
    expect(creates.every((create: any) => create.type === NotificationType.SYSTEM)).toBe(true);
    const visibilityCreates = creates.slice(1, 3);
    expect(JSON.stringify(visibilityCreates)).not.toContain("report-id");
    expect(JSON.stringify(visibilityCreates)).not.toContain("举报人提交的隐私说明");
    expect(visibilityCreates.map((create: any) => create.data)).toEqual([
      { reviewId: "review-id" },
      { reviewId: "review-id" }
    ]);
  });

  it("respects job-notice opt-out for routine workflow but always delivers governance results", async () => {
    const prisma = setup();
    prisma.userPreference.findUnique.mockResolvedValue({ jobNotice: false });
    prisma.reviewReport.findUnique.mockResolvedValue({ reporterId: ownerId });

    await expect(processDomainEventNotifications(prisma, {
      id: "018f1ef0-0000-7000-8000-000000009021",
      aggregateType: "Application",
      eventType: "application.created",
      payload: { ownerId, applicationId: "application-id", jobId: "job-id" }
    })).resolves.toBe(0);
    await expect(processDomainEventNotifications(prisma, {
      id: "018f1ef0-0000-7000-8000-000000009022",
      aggregateType: "ReviewReport",
      eventType: "review_report.resolved",
      payload: { reportId: "report-id", reviewId: "review-id", resolution: ReviewReportStatus.NO_VIOLATION }
    })).resolves.toBe(1);

    expect(prisma.notification.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.notification.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ accountId: ownerId, title: "举报处理完成" })
    }));
  });
});
