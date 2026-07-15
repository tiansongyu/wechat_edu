import { NotificationType, ReviewReportStatus } from "./generated/prisma/enums";

type Payload = Record<string, unknown>;

interface DomainEvent {
  id: string;
  eventType: string;
  aggregateType: string;
  payload: unknown;
}

interface NotificationInput {
  accountId: string;
  title: string;
  content: string;
  data: Record<string, unknown>;
  critical?: boolean;
}

function stringValue(payload: Payload, key: string) {
  const value = payload[key];
  return typeof value === "string" && value ? value : null;
}

export function appointmentNotificationRecipients(payload: Payload) {
  const ownerId = stringValue(payload, "ownerId");
  const teacherId = stringValue(payload, "teacherId");
  const actorId = stringValue(payload, "actorId");
  if (!ownerId || !teacherId) return [];
  if (actorId === ownerId) return [teacherId];
  if (actorId === teacherId) return [ownerId];
  return [...new Set([ownerId, teacherId])];
}

export async function processDomainEventNotifications(prisma: any, event: DomainEvent) {
  const payload = (event.payload && typeof event.payload === "object" ? event.payload : {}) as Payload;
  let delivered = 0;

  const notify = async ({ accountId, title, content, data, critical = false }: NotificationInput) => {
    const preference = await prisma.userPreference.findUnique({ where: { accountId }, select: { jobNotice: true } });
    if (!critical && preference?.jobNotice === false) return;

    await prisma.notification.upsert({
      where: { accountId_sourceEventId: { accountId, sourceEventId: event.id } },
      update: {},
      create: {
        accountId,
        type: event.aggregateType === "Application" ? NotificationType.APPLICATION : NotificationType.SYSTEM,
        title,
        content,
        data,
        sourceEventId: event.id
      }
    });
    delivered += 1;
  };

  if (event.eventType === "application.created") {
    const ownerId = stringValue(payload, "ownerId");
    if (ownerId) {
      await notify({
        accountId: ownerId,
        title: "收到新的老师报名",
        content: "你的家教需求收到一份新的报名，请及时处理。",
        data: { applicationId: payload.applicationId, jobId: payload.jobId }
      });
    }
  }

  if (event.eventType === "application.accepted" || event.eventType === "application.rejected") {
    const teacherId = stringValue(payload, "teacherId");
    if (teacherId) {
      const accepted = event.eventType === "application.accepted";
      await notify({
        accountId: teacherId,
        title: accepted ? "报名已被接受" : "报名结果已更新",
        content: accepted
          ? "家长已接受你的报名，请进入消息中心继续沟通。"
          : stringValue(payload, "note") || "本次报名未被选中，可以继续查看其他需求。",
        data: { applicationId: payload.applicationId, jobId: payload.jobId }
      });
    }
  }

  if (event.eventType === "application.cancelled") {
    const actorId = stringValue(payload, "actorId");
    const teacherId = stringValue(payload, "teacherId");
    const recipient = actorId === teacherId
      ? stringValue(payload, "ownerId")
      : teacherId;
    if (recipient) {
      await notify({
        accountId: recipient,
        title: "报名已取消",
        content: stringValue(payload, "note") || "一条报名记录已被取消。",
        data: { applicationId: payload.applicationId, jobId: payload.jobId }
      });
    }
  }

  if (event.eventType.startsWith("appointment.")) {
    const ownerId = stringValue(payload, "ownerId");
    const teacherId = stringValue(payload, "teacherId");
    const actorId = stringValue(payload, "actorId");
    const administrativeAction = Boolean(ownerId && teacherId && actorId !== ownerId && actorId !== teacherId);
    const labels: Record<string, [string, string]> = {
      "appointment.confirmed": ["预约已确认", "教师已确认本次预约。"],
      "appointment.completed": ["预约已完成", "本次预约已标记完成。"],
      "appointment.cancelled": ["预约已取消", stringValue(payload, "reason") || "本次预约已取消。"],
      "appointment.disputed": ["预约产生争议", stringValue(payload, "reason") || "对方针对本次预约发起了争议。"],
      "appointment.completion_acknowledged": ["收到完成确认", "合作方已确认课程完成，请及时查看预约进度。"]
    };
    const [title, content] = labels[event.eventType] || ["预约状态已更新", "预约状态发生变化，请及时查看。"];
    for (const accountId of appointmentNotificationRecipients(payload)) {
      await notify({
        accountId,
        title,
        content,
        data: { appointmentId: payload.appointmentId, jobId: payload.jobId },
        // An administrative override must reach both affected parties even when
        // either user has muted routine job workflow notifications.
        critical: administrativeAction
      });
    }
  }

  if (event.eventType === "review.created") {
    const revieweeId = stringValue(payload, "revieweeId");
    if (revieweeId) {
      await notify({
        accountId: revieweeId,
        title: "收到新的合作评价",
        content: "合作方已提交评价，可在评价记录中查看。",
        data: {
          reviewId: payload.reviewId,
          appointmentId: payload.appointmentId,
          reviewerRole: payload.reviewerRole,
          revieweeRole: payload.revieweeRole
        },
        critical: true
      });
    }
  }

  if (event.eventType === "review.reported") {
    const reportId = stringValue(payload, "reportId");
    if (reportId) {
      const report = await prisma.reviewReport.findUnique({
        where: { id: reportId },
        select: { reporterId: true }
      });
      if (report?.reporterId) {
        await notify({
          accountId: report.reporterId,
          title: "举报已提交",
          content: "平台已收到你的举报并将尽快核查。低分或意见分歧本身不代表违规。",
          data: { reportId, reviewId: payload.reviewId },
          critical: true
        });
      }
    }
  }

  if (event.eventType === "review.hidden" || event.eventType === "review.restored") {
    const reviewId = stringValue(payload, "reviewId");
    if (reviewId) {
      const review = await prisma.review.findUnique({
        where: { id: reviewId },
        select: { reviewerId: true }
      });
      if (review?.reviewerId) {
        const hidden = event.eventType === "review.hidden";
        await notify({
          accountId: review.reviewerId,
          title: hidden ? "评价已进入平台处理" : "评价已恢复展示",
          content: hidden
            ? "你发布的一条评价经平台复核后已暂停展示。"
            : "你发布的一条评价经复核后已恢复展示。",
          // Do not forward reportId, reporter identity, or a user-authored report
          // description to the review writer; this avoids retaliation leakage.
          data: { reviewId },
          critical: true
        });
      }
    }
  }

  if (event.eventType === "review_report.resolved") {
    const reportId = stringValue(payload, "reportId");
    if (reportId) {
      const report = await prisma.reviewReport.findUnique({
        where: { id: reportId },
        select: { reporterId: true }
      });
      if (report?.reporterId) {
        const actionTaken = payload.resolution === ReviewReportStatus.ACTION_TAKEN;
        await notify({
          accountId: report.reporterId,
          title: "举报处理完成",
          content: actionTaken
            ? "平台已完成核查并对相关评价采取处理措施。"
            : "平台已完成核查，暂未发现需要处置的违规内容。",
          data: { reportId, reviewId: payload.reviewId, resolution: payload.resolution },
          critical: true
        });
      }
    }
  }

  return delivered;
}
