const api = require("../../utils/api");

const STATUS_META = {
  PENDING: { label: "待处理", tone: "pending" },
  ACCEPTED: { label: "已接受", tone: "accepted" },
  REJECTED: { label: "已拒绝", tone: "rejected" },
  CANCELLED: { label: "已取消", tone: "cancelled" }
};

function safeDecode(value) {
  if (!value) return "";
  try {
    return decodeURIComponent(value);
  } catch (error) {
    return String(value);
  }
}

function getErrorMessage(error, fallback) {
  return error && error.message ? error.message : fallback;
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function normalizeApplications(response) {
  const payload = response && response.data ? response.data : response;
  const source = Array.isArray(payload)
    ? payload
    : payload && Array.isArray(payload.items)
      ? payload.items
      : null;

  if (!source) throw new Error("报名记录数据格式异常，请重试");

  return source.map((application) => {
    if (!application || !application.id) throw new Error("报名记录数据不完整，请重试");
    const teacher = application.teacher || application.applicant || {};
    const profile = teacher.teacherProfile || application.teacherProfile || {};
    const status = STATUS_META[application.status] || {
      label: application.status || "状态未知",
      tone: "neutral"
    };
    const displayName = profile.realName || teacher.nickname || "未设置姓名";
    const schoolLine = [profile.school, profile.major, profile.education].filter(Boolean).join(" · ");
    const teachingYears = Number(profile.teachingYears) || 0;
    const subjects = Array.isArray(profile.subjects) ? profile.subjects.filter(Boolean).slice(0, 4) : [];
    const auditMeta = {
      APPROVED: "平台已认证",
      PENDING: "认证审核中",
      REJECTED: "认证未通过"
    }[profile.auditStatus] || "认证状态未知";

    return {
      id: String(application.id),
      teacherId: teacher.id || application.teacherId || "",
      status: application.status,
      statusLabel: status.label,
      statusTone: status.tone,
      displayName,
      avatarUrl: teacher.avatarUrl || "",
      avatarText: displayName.slice(0, 1),
      schoolLine: schoolLine || "教育经历尚未补充",
      teachingLabel: teachingYears > 0 ? `${teachingYears} 年教学经验` : "教学经验尚未补充",
      subjects,
      auditLabel: auditMeta,
      bio: profile.bio || "",
      coverLetter: application.coverLetter || "",
      statusNote: application.statusNote || application.note || "",
      createdLabel: formatDate(application.createdAt),
      handledLabel: application.handledAt ? formatDate(application.handledAt) : ""
    };
  });
}

function buildStats(applications) {
  const pending = applications.filter((item) => item.status === "PENDING").length;
  const accepted = applications.filter((item) => item.status === "ACCEPTED").length;
  return {
    total: applications.length,
    pending,
    handled: applications.length - pending,
    accepted
  };
}

Page({
  data: {
    jobId: "",
    jobTitle: "报名管理",
    applications: [],
    stats: { total: 0, pending: 0, handled: 0, accepted: 0 },
    loading: true,
    refreshing: false,
    loadError: "",
    actionId: "",
    actionType: "",
    syncRequired: false
  },

  onLoad(options = {}) {
    const jobId = String(options.jobId || "").trim();
    const jobTitle = safeDecode(options.title).trim() || "报名管理";
    this.setData({ jobId, jobTitle });
    wx.setNavigationBarTitle({ title: jobTitle.slice(0, 12) });

    if (!jobId) {
      this.setData({ loading: false, loadError: "缺少需求编号，无法加载报名记录" });
      return;
    }
    this.loadApplications({ notify: false });
  },

  async onPullDownRefresh() {
    const success = await this.loadApplications({ preserve: true, notify: false, force: true });
    wx.stopPullDownRefresh();
    if (!success) {
      wx.showToast({ title: "刷新失败，请稍后重试", icon: "none" });
    }
  },

  retryLoad() {
    this.loadApplications({ preserve: this.data.applications.length > 0, notify: false, force: true });
  },

  async loadApplications(options = {}) {
    if (!this.data.jobId) return false;
    if ((this.data.loading || this.data.refreshing) && !options.force) return false;

    const preserve = Boolean(options.preserve && this.data.applications.length);
    this.setData({
      loading: !preserve,
      refreshing: preserve,
      loadError: ""
    });

    try {
      await getApp().ensureAuth();
      const response = await api.listParentApplications(this.data.jobId);
      const normalizedApplications = normalizeApplications(response);
      const applications = await Promise.all(normalizedApplications.map(async (application) => {
        if (!application.teacherId) return { ...application, reviewLabel: "口碑暂不可用" };
        try {
          const result = await api.listTeacherReviews(application.teacherId, { limit: 1 });
          const summary = result.summary || { displayAverage: null, count: 0 };
          return {
            ...application,
            reviewLabel: summary.displayAverage !== null
              ? `${summary.displayAverage}★ · ${summary.count}条评价`
              : `评价积累中 · ${summary.count}条`
          };
        } catch (error) {
          return { ...application, reviewLabel: "口碑暂不可用" };
        }
      }));
      this.setData({
        applications,
        stats: buildStats(applications),
        loadError: "",
        syncRequired: false
      });
      return true;
    } catch (error) {
      const message = getErrorMessage(error, "报名记录加载失败，请稍后重试");
      this.setData({ loadError: message });
      if (options.notify) wx.showToast({ title: message, icon: "none" });
      return false;
    } finally {
      this.setData({ loading: false, refreshing: false });
    }
  },

  handleApplication(event) {
    const id = String(event.currentTarget.dataset.id || "");
    const action = event.currentTarget.dataset.action;
    if (!id || (action !== "accept" && action !== "reject")) return;
    if (this.data.actionId || this.data.syncRequired || this._confirmingAction) return;

    const application = this.data.applications.find((item) => item.id === id);
    if (!application) {
      wx.showToast({ title: "报名记录已变化，请刷新后重试", icon: "none" });
      return;
    }
    if (application.status !== "PENDING") {
      wx.showToast({ title: "该报名已经处理", icon: "none" });
      return;
    }
    this._confirmingAction = true;
    this.confirmAndHandle(application, action);
  },

  showActionModal(application, action) {
    const accepting = action === "accept";
    return new Promise((resolve, reject) => {
      wx.showModal({
        title: accepting ? "确认接受报名" : "确认拒绝报名",
        content: `确认${accepting ? "接受" : "拒绝"}${application.displayName}的报名吗？`,
        editable: true,
        placeholderText: accepting ? "可选填沟通或上课备注" : "请填写拒绝原因（必填）",
        confirmText: accepting ? "确认接受" : "确认拒绝",
        confirmColor: accepting ? "#3478f6" : "#e15858",
        success: resolve,
        fail: reject
      });
    });
  },

  async confirmAndHandle(application, action) {
    const accepting = action === "accept";
    try {
      const modalResult = await this.showActionModal(application, action);
      if (!modalResult.confirm) return;

      const note = String(modalResult.content || "").trim().slice(0, 500);
      if (!accepting && !note) {
        wx.showToast({ title: "请填写拒绝原因", icon: "none" });
        return;
      }
      const commandSignature = `${application.id}:${action}:${note}`;
      if (!this._pendingCommand || this._pendingCommand.signature !== commandSignature) {
        this._pendingCommand = {
          signature: commandSignature,
          key: api.createCommandKey(`application-${action}`, application.id)
        };
      }
      const idempotencyKey = this._pendingCommand.key;
      this.setData({ actionId: application.id, actionType: action });
      if (accepting) {
        await api.acceptApplication(application.id, note, idempotencyKey);
      } else {
        await api.rejectApplication(application.id, note, idempotencyKey);
      }
      this._pendingCommand = null;

      const refreshed = await this.loadApplications({ preserve: true, notify: false, force: true });
      if (!refreshed) {
        this.setData({ syncRequired: true });
        wx.showToast({ title: "处理成功，请重新刷新列表", icon: "none" });
        return;
      }
      wx.showToast({ title: accepting ? "已接受报名" : "已拒绝报名", icon: "success" });
    } catch (error) {
      wx.showToast({
        title: getErrorMessage(error, accepting ? "接受失败，请重试" : "拒绝失败，请重试"),
        icon: "none"
      });
    } finally {
      this._confirmingAction = false;
      this.setData({ actionId: "", actionType: "" });
    }
  },

  async contactTeacher(event) {
    const application = this.data.applications.find((item) => item.id === event.currentTarget.dataset.id);
    if (!application || application.status !== "ACCEPTED" || !application.teacherId || this.data.actionId) return;
    this.setData({ actionId: application.id, actionType: "contact" });
    try {
      const conversation = await api.startConversation(application.teacherId, this.data.jobId);
      wx.navigateTo({
        url: `/pages/conversation/conversation?id=${conversation.id}&title=${encodeURIComponent(application.displayName)}`
      });
    } catch (error) {
      wx.showToast({ title: getErrorMessage(error, "暂时无法联系老师"), icon: "none" });
    } finally {
      this.setData({ actionId: "", actionType: "" });
    }
  },

  openTeacherReviews(event) {
    const teacherId = String(event.currentTarget.dataset.teacherId || "");
    if (!teacherId) return;
    wx.navigateTo({ url: `/pages/reviews/reviews?accountId=${teacherId}` });
  }
});
