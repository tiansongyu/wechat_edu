const api = require("../../utils/api");

const APPLICATION_STATUS = { PENDING: "待处理", ACCEPTED: "已录用", REJECTED: "未选中", CANCELLED: "已取消" };
const APPOINTMENT_STATUS = { PENDING: "待确认", CONFIRMED: "已确认", COMPLETED: "已完成", CANCELLED: "已取消", DISPUTED: "有争议" };

Page({
  data: {
    loading: true,
    error: "",
    actionId: "",
    account: null,
    accountInitial: "人",
    activeRole: "PARENT",
    roleName: "家长版",
    profileMeta: "资料未完善",
    metricTitle: "资料状态",
    metricValue: "未完善",
    metricHint: "完善资料后可获得更准确的匹配",
    auditNote: "",
    activePanel: "applications",
    applications: [],
    favorites: [],
    posts: [],
    appointments: [],
    visibleItems: [],
    panelTitle: "报名动态",
    showSettings: false,
    settings: { jobNotice: true, chatNotice: true, privacyMode: true },
    showParentEditor: false,
    parentForm: { city: "", district: "", address: "" },
    savingParent: false
  },

  onShow() {
    this.loadData();
  },

  async onPullDownRefresh() {
    await this.loadData(false);
    wx.stopPullDownRefresh();
  },

  async loadData(showLoading = true) {
    if (showLoading) this.setData({ loading: true, error: "" });
    try {
      await getApp().ensureAuth();
      const account = await api.getAccount();
      const activeRole = account.activeRole || api.getActiveRole();
      const roleApplications = activeRole === "TEACHER" ? api.listTeacherApplications() : api.listAllParentApplications();
      const [rawPosts, rawFavorites, rawApplications, preferences, rawAppointments] = await Promise.all([
        api.getMineJobs(),
        api.listFavoriteJobs(),
        roleApplications,
        api.getPreferences(),
        api.listAppointments()
      ]);
      const expectedPostType = activeRole === "TEACHER" ? "TEACHER_OFFER" : "TEACHING_NEED";
      const posts = rawPosts
        .filter((item) => item.type === expectedPostType)
        .map((item) => ({ ...api.normalizeJob(item), recordType: "post" }));
      const favorites = rawFavorites.map((item) => ({ ...api.normalizeJob(item), recordType: "favorite" }));
      const applications = rawApplications.map((item) => this.normalizeApplication(item, activeRole));
      const appointments = rawAppointments
        .filter((item) => activeRole === "TEACHER"
          ? item.application && item.application.teacherId === account.id
          : item.job && item.job.ownerId === account.id)
        .map((item) => this.normalizeAppointment(item, account.id, activeRole));
      const parentProfile = account.parentProfile || {};
      const teacherProfile = account.teacherProfile || {};
      const profileMeta = activeRole === "TEACHER"
        ? [teacherProfile.school, teacherProfile.major].filter(Boolean).join(" · ") || "教师资料未完善"
        : [parentProfile.city, parentProfile.district].filter(Boolean).join(" · ") || "常用区域未完善";
      const metricTitle = activeRole === "TEACHER" ? "教师信誉分" : "家长资料";
      const metricValue = activeRole === "TEACHER"
        ? String(teacherProfile.score === undefined || teacherProfile.score === null ? "--" : teacherProfile.score)
        : [parentProfile.city, parentProfile.district, parentProfile.address].filter(Boolean).length === 3 ? "已完善" : "待完善";
      const metricHint = activeRole === "TEACHER"
        ? (!teacherProfile.submittedAt
          ? "尚未提交审核，请先完善教师资料"
          : ({ APPROVED: "认证已通过", PENDING: "资料正在审核", REJECTED: "资料被退回，请按意见修改" }[teacherProfile.auditStatus] || "请完善教师认证资料"))
        : "完善常用区域和地址可提高匹配准确度";
      this.setData({
        account,
        accountInitial: account.nickname ? account.nickname.slice(0, 1) : "人",
        activeRole,
        roleName: activeRole === "TEACHER" ? "老师版" : "家长版",
        profileMeta,
        metricTitle,
        metricValue,
        metricHint,
        auditNote: teacherProfile.auditNote || "",
        applications,
        favorites,
        posts,
        appointments,
        settings: { ...this.data.settings, ...(preferences || {}) },
        parentForm: { city: parentProfile.city || "", district: parentProfile.district || "", address: parentProfile.address || "" },
        loading: false,
        error: ""
      }, () => this.applyPanel());
      getApp().globalData.account = account;
      getApp().globalData.activeRole = activeRole;
    } catch (error) {
      this.setData({ loading: false, error: error.message || "个人中心加载失败", visibleItems: [] });
    }
  },

  normalizeApplication(item, role) {
    const job = api.normalizeJob(item.job || {});
    const teacher = item.teacher || {};
    return {
      id: item.id,
      jobId: item.jobId || job.id,
      title: role === "TEACHER" ? (job.title || "已删除的家教需求") : `${teacher.nickname || "老师"}申请：${job.title || "家教需求"}`,
      meta: role === "TEACHER" ? `${job.locationLabel || "地点待沟通"} · ¥${job.price || "--"}${job.unit || ""}` : [teacher.teacherProfile && teacher.teacherProfile.school, teacher.teacherProfile && teacher.teacherProfile.major].filter(Boolean).join(" · ") || "教师资料未完善",
      status: item.status,
      statusLabel: APPLICATION_STATUS[item.status] || item.status,
      statusNote: item.statusNote || item.note || "",
      recordType: "application"
    };
  },

  normalizeAppointment(item, accountId, activeRole) {
    const job = api.normalizeJob(item.job || (item.application && item.application.job) || {});
    const ownerId = item.job && item.job.ownerId;
    const teacherId = item.application && item.application.teacherId;
    return {
      ...item,
      jobId: item.jobId || job.id,
      title: job.title || "合作预约",
      meta: [job.locationLabel, item.startAt ? api.formatDate(item.startAt) : "时间待确认"].filter(Boolean).join(" · "),
      statusLabel: APPOINTMENT_STATUS[item.status] || item.status,
      canConfirm: activeRole === "TEACHER" && item.status === "PENDING" && teacherId === accountId,
      canComplete: activeRole === "PARENT" && item.status === "CONFIRMED" && ownerId === accountId,
      canCancel: (item.status === "PENDING" || item.status === "CONFIRMED") && (ownerId === accountId || teacherId === accountId),
      canDispute: ["PENDING", "CONFIRMED", "COMPLETED"].includes(item.status) && (ownerId === accountId || teacherId === accountId),
      recordType: "appointment"
    };
  },

  retry() { this.loadData(); },

  async switchRole() {
    if (this.data.actionId) return;
    const next = this.data.activeRole === "TEACHER" ? "PARENT" : "TEACHER";
    this.setData({ actionId: "role" });
    wx.showLoading({ title: "切换中" });
    try {
      await api.switchRole(next);
      getApp().globalData.activeRole = next;
      getApp().globalData.account = null;
      getApp().globalData.authReady = null;
      await getApp().ensureAuth(true);
      this.setData({ activePanel: "applications", showParentEditor: false, showSettings: false });
      await this.loadData(false);
      wx.showToast({ title: `已进入${next === "TEACHER" ? "老师" : "家长"}版`, icon: "none" });
    } catch (error) {
      wx.showToast({ title: error.message || "切换失败", icon: "none" });
    } finally {
      wx.hideLoading();
      this.setData({ actionId: "" });
    }
  },

  selectPanel(event) {
    this.setData({ activePanel: event.currentTarget.dataset.panel }, () => this.applyPanel());
  },

  applyPanel() {
    const panelMap = {
      applications: { title: this.data.activeRole === "TEACHER" ? "我的申请" : "收到的报名", items: this.data.applications },
      favorites: { title: "我的收藏", items: this.data.favorites },
      posts: { title: "我的发布", items: this.data.posts },
      appointments: { title: "合作预约", items: this.data.appointments }
    };
    const current = panelMap[this.data.activePanel] || panelMap.applications;
    this.setData({ panelTitle: current.title, visibleItems: current.items });
  },

  openItem(event) {
    const item = this.data.visibleItems.find((entry) => entry.id === event.currentTarget.dataset.id);
    if (!item) return;
    if (item.recordType === "application" && this.data.activeRole === "PARENT") {
      wx.navigateTo({ url: `/pages/job-applications/job-applications?jobId=${item.jobId}` });
      return;
    }
    if (item.jobId || item.id) wx.navigateTo({ url: `/pages/job-detail/job-detail?id=${item.jobId || item.id}` });
  },

  cancelApplication(event) {
    const id = event.currentTarget.dataset.id;
    wx.showModal({
      title: "取消申请",
      content: "取消后发布人将不再处理本次申请，请填写取消原因。",
      editable: true,
      placeholderText: "请输入取消原因（必填）",
      confirmText: "确认取消",
      confirmColor: "#d85858",
      success: async ({ confirm, content }) => {
        if (!confirm || this.data.actionId) return;
        const reason = String(content || "").trim();
        if (!reason) {
          wx.showToast({ title: "请输入取消原因", icon: "none" });
          return;
        }
        this.setData({ actionId: id });
        try {
          await api.cancelApplication(id, reason);
          await this.loadData(false);
          wx.showToast({ title: "申请已取消", icon: "none" });
        } catch (error) {
          wx.showToast({ title: error.message || "取消失败", icon: "none" });
        } finally {
          this.setData({ actionId: "" });
        }
      }
    });
  },

  improveProfile() {
    if (this.data.activeRole === "TEACHER") wx.navigateTo({ url: "/pages/teacher-profile/teacher-profile" });
    else this.setData({ showParentEditor: true, showSettings: false });
  },

  closeParentEditor() { this.setData({ showParentEditor: false }); },
  handleParentInput(event) { this.setData({ [`parentForm.${event.currentTarget.dataset.field}`]: event.detail.value }); },

  async saveParentProfile() {
    const form = this.data.parentForm;
    if (!form.city.trim() || !form.district.trim()) {
      wx.showToast({ title: "请填写城市和区域", icon: "none" });
      return;
    }
    this.setData({ savingParent: true });
    try {
      await api.updateParentProfile({ city: form.city.trim(), district: form.district.trim(), address: form.address.trim() });
      this.setData({ showParentEditor: false });
      await this.loadData(false);
      wx.showToast({ title: "资料已保存", icon: "success" });
    } catch (error) {
      wx.showToast({ title: error.message || "保存失败", icon: "none" });
    } finally {
      this.setData({ savingParent: false });
    }
  },

  toggleSettings() { this.setData({ showSettings: !this.data.showSettings, showParentEditor: false }); },

  async updateSetting(event) {
    const field = event.currentTarget.dataset.field;
    const value = event.detail.value;
    try {
      const preferences = await api.updatePreferences({ [field]: value });
      this.setData({ settings: { ...this.data.settings, ...(preferences || {}), [field]: value } });
    } catch (error) {
      this.setData({ settings: { ...this.data.settings } });
      wx.showToast({ title: error.message || "设置保存失败", icon: "none" });
    }
  },

  appointmentAction(event) {
    const id = event.currentTarget.dataset.id;
    const action = event.currentTarget.dataset.action;
    const labels = { confirm: "确认预约", complete: "确认完成", cancel: "取消预约", dispute: "发起争议" };
    const requiresReason = action === "cancel" || action === "dispute";
    wx.showModal({
      title: labels[action] || "更新预约",
      content: requiresReason ? `${action === "cancel" ? "取消" : "争议"}会同步给合作方，请填写原因。` : "操作结果会同步到双方的数据库记录。",
      editable: requiresReason,
      placeholderText: requiresReason ? `请输入${action === "cancel" ? "取消" : "争议"}原因（必填）` : "",
      confirmText: "确认",
      confirmColor: requiresReason ? "#d85858" : "#3478f6",
      success: async ({ confirm, content }) => {
        if (!confirm || this.data.actionId) return;
        const reason = String(content || "").trim();
        if (requiresReason && !reason) {
          wx.showToast({ title: `请输入${action === "cancel" ? "取消" : "争议"}原因`, icon: "none" });
          return;
        }
        this.setData({ actionId: id });
        try {
          await api.updateAppointment(id, action, reason);
          await this.loadData(false);
          wx.showToast({ title: "预约状态已更新", icon: "success" });
        } catch (error) {
          wx.showToast({ title: error.message || "操作失败", icon: "none" });
        } finally {
          this.setData({ actionId: "" });
        }
      }
    });
  }
});
