const api = require("../../utils/api");
const DEFAULT_REGION = ["广东省", "深圳市", "南山区"];

const APPLICATION_STATUS = { PENDING: "待处理", ACCEPTED: "已录用", REJECTED: "未选中", CANCELLED: "已取消" };
const APPOINTMENT_STATUS = { PENDING: "待确认", CONFIRMED: "已确认", COMPLETED: "已完成", CANCELLED: "已取消", DISPUTED: "有争议" };

Page({
  data: {
    loading: true,
    error: "",
    actionId: "",
    rolePromptOpen: false,
    account: null,
    accountInitial: "人",
    showNicknameEditor: false,
    nicknameDraft: "",
    savingNickname: false,
    activeRole: "PARENT",
    roleName: "家长版",
    profileMeta: "资料未完善",
    identityHint: "完善身份与匹配资料",
    metricTitle: "资料状态",
    metricValue: "未完善",
    metricHint: "完善资料后可获得更准确的匹配",
    receivedReviewSummary: { displayAverage: null, count: 0, levelLabel: "评价积累中" },
    reviewSummaryUnavailable: false,
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
    parentRegion: DEFAULT_REGION,
    parentForm: { province: "", city: "", district: "", address: "", latitude: "", longitude: "" },
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
      const [rawPosts, rawFavorites, rawApplications, preferences, rawAppointments, receivedReviews] = await Promise.all([
        api.getMineJobs(),
        api.listFavoriteJobs(),
        roleApplications,
        api.getPreferences(),
        api.listAppointments(),
        api.listMyReceivedReviews({ limit: 3 }).catch(() => ({
          unavailable: true,
          items: [],
          summary: { displayAverage: null, count: 0, levelLabel: "评价积累中" }
        }))
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
      const identityHint = activeRole === "TEACHER"
        ? !teacherProfile.submittedAt
          ? "教师认证尚未提交"
          : teacherProfile.auditStatus === "APPROVED"
            ? "教师认证已通过"
            : teacherProfile.auditStatus === "PENDING"
              ? "教师认证正在审核"
              : `认证需修改：${teacherProfile.auditNote || "请查看审核意见"}`
        : [parentProfile.city, parentProfile.district, parentProfile.address].filter(Boolean).length === 3
          ? "家长常用区域与地址已完善"
          : "完善常用区域可获得更准确的匹配";
      const receivedReviewSummary = receivedReviews.summary || { displayAverage: null, count: 0, levelLabel: "评价积累中" };
      const reviewSummaryUnavailable = Boolean(receivedReviews.unavailable);
      const metricTitle = activeRole === "TEACHER" ? "我的教师口碑" : "我的家长口碑";
      const metricValue = reviewSummaryUnavailable
        ? "暂不可用"
        : receivedReviewSummary.displayAverage !== null
          ? `${receivedReviewSummary.displayAverage} ★`
          : receivedReviewSummary.count
            ? `${receivedReviewSummary.count} 条`
            : "待积累";
      const metricHint = reviewSummaryUnavailable
        ? "口碑加载失败 · 点击进入重试查看"
        : `${receivedReviewSummary.levelLabel || "评价积累中"} · 查看 ${receivedReviewSummary.count || 0} 条真实合作评价`;
      this.setData({
        account,
        accountInitial: account.nickname ? account.nickname.slice(0, 1) : "人",
        nicknameDraft: account.nickname || "",
        activeRole,
        roleName: activeRole === "TEACHER" ? "老师版" : "家长版",
        profileMeta,
        identityHint,
        metricTitle,
        metricValue,
        metricHint,
        receivedReviewSummary,
        reviewSummaryUnavailable,
        auditNote: teacherProfile.auditNote || "",
        applications,
        favorites,
        posts,
        appointments,
        settings: { ...this.data.settings, ...(preferences || {}) },
        parentRegion: [parentProfile.province || "广东省", parentProfile.city || "深圳市", parentProfile.district || "南山区"],
        parentForm: {
          province: parentProfile.province || "",
          city: parentProfile.city || "",
          district: parentProfile.district || "",
          address: parentProfile.address || "",
          latitude: parentProfile.latitude === null || parentProfile.latitude === undefined ? "" : parentProfile.latitude,
          longitude: parentProfile.longitude === null || parentProfile.longitude === undefined ? "" : parentProfile.longitude
        },
        loading: false,
        error: ""
      }, () => this.applyPanel());
      getApp().globalData.account = account;
      getApp().globalData.activeRole = activeRole;
      return true;
    } catch (error) {
      this.setData({ loading: false, error: error.message || "个人中心加载失败", visibleItems: [] });
      return false;
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
    const completionActions = item.completionActions || {};
    const completionProgress = item.completionProgress || {};
    let statusLabel = APPOINTMENT_STATUS[item.status] || item.status;
    let workflowHint = item.statusNote || "";
    if (item.status === "CONFIRMED") {
      if (completionActions.canAcknowledge) {
        statusLabel = "待我确认完成";
        workflowHint = "确认本次服务已完成后，还需等待合作方确认";
      } else if (completionActions.waitingForOtherParty) {
        statusLabel = "等待对方确认";
        workflowHint = "我已确认完成，正在等待合作方确认";
      } else if (completionActions.requiresRoleSwitch) {
        statusLabel = "切换身份确认";
        workflowHint = `请切换到${completionActions.requiredRole === "TEACHER" ? "老师" : "家长"}版确认完成`;
      }
    } else if (item.status === "COMPLETED") {
      if (item.canReview) {
        statusLabel = "待评价";
        workflowHint = `双方已确认完成，可以评价${item.reviewTarget ? item.reviewTarget.label : "合作方"}`;
      } else if (item.myReview) {
        statusLabel = "已评价";
        workflowHint = `已提交 ${item.myReview.rating} 星评价`;
      } else if (completionProgress.fullyAcknowledged) {
        workflowHint = "双方均已确认本次合作完成";
      }
    }
    return {
      ...item,
      jobId: item.jobId || job.id,
      title: job.title || "合作预约",
      meta: [job.locationLabel, item.startAt ? api.formatDate(item.startAt) : "时间待确认"].filter(Boolean).join(" · "),
      statusLabel,
      workflowHint,
      canConfirm: activeRole === "TEACHER" && item.status === "PENDING" && teacherId === accountId,
      canComplete: Boolean(completionActions.canAcknowledge),
      hasAcknowledged: Boolean(completionActions.hasAcknowledged),
      waitingForOtherParty: Boolean(completionActions.waitingForOtherParty),
      requiresRoleSwitch: Boolean(completionActions.requiresRoleSwitch),
      canReview: Boolean(item.canReview),
      myReview: item.myReview || null,
      reviewTarget: item.reviewTarget || null,
      canCancel: (item.status === "PENDING" || item.status === "CONFIRMED") && (ownerId === accountId || teacherId === accountId),
      canDispute: ["PENDING", "CONFIRMED", "COMPLETED"].includes(item.status) && (ownerId === accountId || teacherId === accountId),
      recordType: "appointment"
    };
  },

  retry() { this.loadData(); },

  editNickname() {
    if (!this.data.account || this.data.savingNickname) return;
    this.setData({
      showNicknameEditor: true,
      nicknameDraft: this.data.account.nickname || ""
    });
  },

  closeNicknameEditor() {
    if (this.data.savingNickname) return;
    this.setData({ showNicknameEditor: false });
  },

  preventNicknameClose() {},

  handleNicknameInput(event) {
    this.setData({ nicknameDraft: event.detail.value });
  },

  async saveNickname() {
    if (this.data.savingNickname) return;
    const nickname = String(this.data.nicknameDraft || "").trim().replace(/\s+/g, " ");
    if (!nickname) {
      wx.showToast({ title: "请输入昵称", icon: "none" });
      return;
    }
    if (nickname.length > 30) {
      wx.showToast({ title: "昵称最多30个字符", icon: "none" });
      return;
    }
    if (nickname === this.data.account.nickname) {
      this.setData({ showNicknameEditor: false, nicknameDraft: nickname });
      wx.showToast({ title: "昵称未发生变化", icon: "none" });
      return;
    }

    this.setData({ savingNickname: true });
    try {
      const account = await api.updateAccount({ nickname });
      this.setData({
        account,
        accountInitial: account.nickname ? account.nickname.slice(0, 1) : "人",
        nicknameDraft: account.nickname || "",
        showNicknameEditor: false
      });
      getApp().globalData.account = account;
      wx.showToast({ title: "昵称已保存", icon: "success" });
    } catch (error) {
      wx.showToast({ title: error.message || "昵称保存失败", icon: "none" });
    } finally {
      this.setData({ savingNickname: false });
    }
  },

  switchRole() {
    if (this.data.actionId || this.data.rolePromptOpen) return;
    const next = this.data.activeRole === "TEACHER" ? "PARENT" : "TEACHER";
    this.setData({ rolePromptOpen: true });
    wx.showModal({
      title: `切换到${next === "TEACHER" ? "老师" : "家长"}版？`,
      content: "切换只会改变当前浏览与操作身份，不会自动申请、联系、发布、取消或评价任何内容。",
      confirmText: "确认切换",
      confirmColor: "#3478f6",
      success: ({ confirm }) => {
        this.setData({ rolePromptOpen: false });
        if (confirm) this.performRoleSwitch(next);
      },
      fail: () => this.setData({ rolePromptOpen: false })
    });
  },

  async performRoleSwitch(next) {
    if (this.data.actionId) return;
    this.setData({ actionId: "role" });
    try {
      const result = await getApp().switchActiveRole(next);
      this.setData({
        activeRole: next,
        roleName: next === "TEACHER" ? "老师版" : "家长版",
        account: result.account || this.data.account,
        activePanel: "applications",
        showParentEditor: false,
        showSettings: false
      });
      const refreshed = await this.loadData(false);
      wx.showToast({
        title: refreshed
          ? `已进入${next === "TEACHER" ? "老师" : "家长"}版`
          : "身份已切换，个人资料暂未刷新",
        icon: "none"
      });
    } catch (error) {
      wx.showToast({ title: error.message || "身份切换失败", icon: "none" });
    } finally {
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

  openReceivedReviews() {
    wx.navigateTo({ url: "/pages/reviews/reviews?received=1" });
  },

  goReview(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: `/pages/reviews/reviews?appointmentId=${id}` });
  },

  closeParentEditor() { this.setData({ showParentEditor: false }); },
  handleParentRegion(event) {
    const parentRegion = event.detail.value || DEFAULT_REGION;
    this.setData({
      parentRegion,
      "parentForm.province": parentRegion[0],
      "parentForm.city": parentRegion[1],
      "parentForm.district": parentRegion[2],
      "parentForm.address": "",
      "parentForm.latitude": "",
      "parentForm.longitude": ""
    });
  },

  chooseParentLocation() {
    if (!this.data.parentForm.district) {
      wx.showToast({ title: "请先选择省市区", icon: "none" });
      return;
    }
    wx.chooseLocation({
      success: ({ address, name, latitude, longitude }) => {
        this.setData({
          "parentForm.address": [name, address].filter(Boolean).join(" · "),
          "parentForm.latitude": latitude,
          "parentForm.longitude": longitude
        });
      },
      fail: (error) => {
        if (error && /cancel/i.test(error.errMsg || "")) return;
        wx.showToast({ title: "未能选择地址，请检查定位权限", icon: "none" });
      }
    });
  },

  async saveParentProfile() {
    const form = this.data.parentForm;
    if (!form.province.trim() || !form.city.trim() || !form.district.trim()) {
      wx.showToast({ title: "请选择完整省市区", icon: "none" });
      return;
    }
    this.setData({ savingParent: true });
    try {
      await api.updateParentProfile({
        province: form.province.trim(),
        city: form.city.trim(),
        district: form.district.trim(),
        address: form.address.trim() || undefined,
        latitude: form.latitude === "" ? undefined : Number(form.latitude),
        longitude: form.longitude === "" ? undefined : Number(form.longitude)
      });
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
      content: requiresReason
        ? `${action === "cancel" ? "取消" : "争议"}会同步给合作方，请填写原因。`
        : action === "complete"
          ? "请确认本次服务已经完成。提交后还需合作方确认，双方确认后才会进入已完成。"
          : "确认后，预约状态会同步给合作双方。",
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
