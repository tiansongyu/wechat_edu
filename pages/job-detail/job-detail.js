const api = require("../../utils/api");

Page({
  data: {
    loading: true,
    error: "",
    action: "",
    job: null,
    jobId: "",
    account: null,
    activeRole: "PARENT",
    currentApplication: null,
    applicationLabel: "",
    applicationActionLabel: "立即申请",
    teacherCanApply: false,
    teacherApplicationAction: "完善教师认证",
    teacherApplicationReason: "请先完善并提交教师认证资料",
    isOwner: false,
    ownerRole: "PARENT",
    expectedViewerRole: "TEACHER",
    ownerRoleMismatch: false,
    viewerRoleMismatch: false,
    canApply: false,
    canContact: false,
    canManageApplications: false,
    contactLabel: "联系发布人",
    publisherActionLabel: "联系"
  },

  onLoad(options) {
    const jobId = options.id || "";
    this.setData({ jobId });
    if (!jobId) {
      this.setData({ loading: false, error: "缺少家教信息编号" });
      return;
    }
    this.loadData();
  },

  onShow() {
    if (this.data.jobId && this.data.job) this.loadData(false);
  },

  async loadData(showLoading = true) {
    if (showLoading) this.setData({ loading: true, error: "" });
    try {
      const account = await getApp().ensureAuth();
      const activeRole = account.activeRole || api.getActiveRole();
      const teacherEligibility = api.getTeacherApplicationEligibility(account.teacherProfile || {});
      const requests = [api.getJob(this.data.jobId)];
      if (activeRole === "TEACHER") requests.push(api.listTeacherApplications());
      const [rawJob, applications = []] = await Promise.all(requests);
      const job = api.normalizeJob(rawJob);
      const currentApplication = activeRole === "TEACHER"
        ? (rawJob.currentApplication
          || applications.find((item) => (item.jobId || (item.job && item.job.id)) === job.id)
          || null)
        : null;
      const isOwner = Boolean(job.owner && job.owner.id === account.id);
      const ownerRole = job.type === "TEACHING_NEED" ? "PARENT" : "TEACHER";
      const expectedViewerRole = job.type === "TEACHING_NEED" ? "TEACHER" : "PARENT";
      const ownerRoleMismatch = isOwner && activeRole !== ownerRole;
      const viewerRoleMismatch = !isOwner && activeRole !== expectedViewerRole;
      const applicationLabel = currentApplication
        ? ({ PENDING: "申请审核中", ACCEPTED: "已被录用", REJECTED: "本次未选中", CANCELLED: "重新申请" }[currentApplication.status] || currentApplication.status)
        : job.status === "PUBLISHED"
          ? (teacherEligibility.canApply ? "今天可申请" : teacherEligibility.actionLabel)
          : job.statusLabel;
      const applicationActionLabel = currentApplication && currentApplication.status !== "CANCELLED"
        ? applicationLabel
        : job.status === "PUBLISHED"
          ? teacherEligibility.actionLabel
          : job.statusLabel;
      const canApply = activeRole === "TEACHER"
        && job.type === "TEACHING_NEED"
        && job.status === "PUBLISHED"
        && !isOwner
        && teacherEligibility.canApply
        && (!currentApplication || currentApplication.status === "CANCELLED");
      const canContact = !isOwner && (
        (job.type === "TEACHING_NEED" && activeRole === "TEACHER" && currentApplication && currentApplication.status === "ACCEPTED")
        || (job.type === "TEACHER_OFFER" && activeRole === "PARENT" && job.status === "PUBLISHED")
      );
      this.setData({
        account,
        activeRole,
        job,
        currentApplication,
        applicationLabel,
        applicationActionLabel,
        teacherCanApply: teacherEligibility.canApply,
        teacherApplicationAction: teacherEligibility.actionLabel,
        teacherApplicationReason: teacherEligibility.reason,
        isOwner,
        ownerRole,
        expectedViewerRole,
        ownerRoleMismatch,
        viewerRoleMismatch,
        canApply,
        canContact,
        canManageApplications: isOwner && activeRole === "PARENT" && job.type === "TEACHING_NEED",
        contactLabel: job.type === "TEACHER_OFFER" ? "联系老师" : "联系发布人",
        publisherActionLabel: isOwner ? "管理" : viewerRoleMismatch ? "切换" : "联系",
        loading: false,
        error: ""
      });
      wx.setNavigationBarTitle({ title: job.title.slice(0, 12) });
    } catch (error) {
      this.setData({ loading: false, error: error.message || "详情加载失败", job: null });
    }
  },

  retry() { this.loadData(); },

  applyJob() {
    if (this.data.activeRole !== "TEACHER") {
      wx.showToast({ title: "请先切换到老师版", icon: "none" });
      return;
    }
    if (!this.data.job || this.data.job.status !== "PUBLISHED") {
      wx.showToast({ title: "该发布当前不可申请", icon: "none" });
      return;
    }
    if (this.data.currentApplication && this.data.currentApplication.status !== "CANCELLED") {
      wx.showToast({ title: this.data.applicationLabel, icon: "none" });
      return;
    }
    if (!this.data.teacherCanApply) {
      if (this.data.teacherApplicationAction === "认证审核中") {
        wx.showToast({ title: this.data.teacherApplicationReason, icon: "none" });
      } else {
        wx.navigateTo({ url: "/pages/teacher-profile/teacher-profile" });
      }
      return;
    }
    wx.showModal({
      title: "确认申请",
      content: "平台将使用数据库中的教师认证资料提交申请。",
      confirmText: "提交申请",
      confirmColor: "#3478f6",
      success: async ({ confirm }) => {
        if (!confirm || this.data.action) return;
        this.setData({ action: "apply" });
        try {
          await api.applyJob(this.data.job.id);
          await this.loadData(false);
          wx.showToast({ title: "申请已提交", icon: "success" });
        } catch (error) {
          wx.showToast({ title: error.message || "申请失败", icon: "none" });
        } finally {
          this.setData({ action: "" });
        }
      }
    });
  },

  cancelApplication() {
    const application = this.data.currentApplication;
    if (this.data.activeRole !== "TEACHER" || !application || application.status !== "PENDING") return;
    wx.showModal({
      title: "取消申请",
      content: "取消后发布人将不再处理本次申请，请填写取消原因。",
      editable: true,
      placeholderText: "请输入取消原因（必填）",
      confirmText: "确认取消",
      confirmColor: "#d85858",
      success: async ({ confirm, content }) => {
        if (!confirm || this.data.action) return;
        const reason = String(content || "").trim();
        if (!reason) {
          wx.showToast({ title: "请输入取消原因", icon: "none" });
          return;
        }
        this.setData({ action: "cancel" });
        try {
          await api.cancelApplication(application.id, reason);
          await this.loadData(false);
          wx.showToast({ title: "申请已取消", icon: "none" });
        } catch (error) {
          wx.showToast({ title: error.message || "取消失败", icon: "none" });
        } finally {
          this.setData({ action: "" });
        }
      }
    });
  },

  async toggleFavorite() {
    if (!this.data.job || this.data.action) return;
    const favorite = !this.data.job.favorite;
    this.setData({ action: "favorite" });
    try {
      await api.favoriteJob(this.data.job.id, favorite);
      await this.loadData(false);
      wx.showToast({ title: favorite ? "已收藏" : "已取消收藏", icon: "none" });
    } catch (error) {
      wx.showToast({ title: error.message || "收藏操作失败", icon: "none" });
    } finally {
      this.setData({ action: "" });
    }
  },

  async contactPublisher() {
    const { job, activeRole, currentApplication, action, viewerRoleMismatch } = this.data;
    if (!job || action) return;
    if (this.data.isOwner) {
      if (this.data.canManageApplications) this.manageApplications();
      else this.openMyPosts();
      return;
    }
    if (viewerRoleMismatch) {
      this.switchViewerRole();
      return;
    }
    if (activeRole === "TEACHER" && job.type === "TEACHING_NEED" && (!currentApplication || currentApplication.status !== "ACCEPTED")) {
      if (this.data.canApply) this.applyJob();
      else wx.showToast({ title: currentApplication ? this.data.applicationLabel : "该发布当前不可申请", icon: "none" });
      return;
    }
    if (!this.data.canContact || !job.owner || !job.owner.id) {
      wx.showToast({ title: "发布人信息暂不可用", icon: "none" });
      return;
    }
    this.setData({ action: "contact" });
    try {
      const conversation = await api.startConversation(job.owner.id, job.id);
      wx.navigateTo({ url: `/pages/conversation/conversation?id=${conversation.id}&title=${encodeURIComponent(job.publisher)}` });
    } catch (error) {
      wx.showToast({ title: error.message || "暂时无法建立会话", icon: "none" });
    } finally {
      this.setData({ action: "" });
    }
  },

  manageApplications() {
    const job = this.data.job;
    if (!job || !this.data.canManageApplications) return;
    wx.navigateTo({ url: `/pages/job-applications/job-applications?jobId=${job.id}&title=${encodeURIComponent(job.title)}` });
  },

  async switchRoleAndReload(role) {
    if (this.data.action || this.data.activeRole === role) return true;
    this.setData({ action: "role" });
    wx.showLoading({ title: "切换中" });
    let switched = false;
    let errorMessage = "";
    try {
      await api.switchRole(role);
      getApp().globalData.activeRole = role;
      getApp().globalData.account = null;
      getApp().globalData.authReady = null;
      await getApp().ensureAuth(true);
      switched = true;
    } catch (error) {
      errorMessage = error.message || "角色切换失败";
    } finally {
      wx.hideLoading();
      this.setData({ action: "" });
    }
    if (errorMessage) wx.showToast({ title: errorMessage, icon: "none" });
    return switched;
  },

  async switchViewerRole() {
    const role = this.data.expectedViewerRole;
    const switched = await this.switchRoleAndReload(role);
    if (switched) {
      await this.loadData(false);
      wx.showToast({ title: `已进入${role === "TEACHER" ? "老师" : "家长"}版`, icon: "none" });
    }
  },

  async openMyPosts() {
    if (this.data.ownerRoleMismatch) {
      const switched = await this.switchRoleAndReload(this.data.ownerRole);
      if (!switched) return;
    }
    wx.switchTab({ url: "/pages/publish/publish" });
  },

  onShareAppMessage() {
    const job = this.data.job;
    if (!job) return { title: "家教直聘", path: "/pages/index/index" };
    return { title: `${job.price}${job.unit}｜${job.title}`, path: `/pages/job-detail/job-detail?id=${job.id}` };
  }
});
