const api = require("../../utils/api");

Page({
  data: {
    loading: true,
    error: "",
    refreshError: "",
    action: "",
    rolePromptOpen: false,
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
    publisherActionLabel: "联系",
    publisherReviewSummary: null,
    publisherReviewError: "",
    publisherReviewLoading: false
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
    if (showLoading) this.setData({ loading: true, error: "", refreshError: "" });
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
        publisherReviewSummary: null,
        publisherReviewError: "",
        publisherReviewLoading: job.type === "TEACHER_OFFER",
        loading: false,
        error: "",
        refreshError: ""
      });
      if (job.type === "TEACHER_OFFER" && job.owner && job.owner.id) {
        this.loadPublisherReview(job.owner.id);
      }
      wx.setNavigationBarTitle({ title: job.title.slice(0, 12) });
      return true;
    } catch (error) {
      const message = error.message || "详情加载失败";
      if (showLoading || !this.data.job) this.setData({ loading: false, error: message, refreshError: "", job: null });
      else this.setData({ loading: false, error: "", refreshError: message });
      return false;
    }
  },

  retry() { this.loadData(); },

  async loadPublisherReview(teacherId) {
    try {
      const reviewResult = await api.listTeacherReviews(teacherId, { limit: 3 });
      if (!this.data.job || !this.data.job.owner || this.data.job.owner.id !== teacherId) return;
      this.setData({ publisherReviewSummary: reviewResult.summary || null, publisherReviewError: "", publisherReviewLoading: false });
    } catch (error) {
      if (!this.data.job || !this.data.job.owner || this.data.job.owner.id !== teacherId) return;
      this.setData({ publisherReviewSummary: null, publisherReviewError: error.message || "老师口碑暂时加载失败", publisherReviewLoading: false });
    }
  },

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
      content: "平台将使用你当前已通过审核的教师资料提交申请。",
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
        const commandSignature = `${application.id}:application-cancel:${reason}`;
        if (!this._pendingCommand || this._pendingCommand.signature !== commandSignature) {
          this._pendingCommand = {
            signature: commandSignature,
            key: api.createCommandKey("application-cancel", application.id)
          };
        }
        this.setData({ action: "cancel" });
        try {
          await api.cancelApplication(application.id, reason, this._pendingCommand.key);
          this._pendingCommand = null;
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

  openPublisherReviews() {
    const job = this.data.job;
    if (!job || job.type !== "TEACHER_OFFER" || !job.owner || !job.owner.id) return;
    wx.navigateTo({ url: `/pages/reviews/reviews?accountId=${job.owner.id}` });
  },

  requestRoleSwitch(role) {
    if (!role || this.data.action || this.data.rolePromptOpen || this.data.activeRole === role) return;
    this.setData({ rolePromptOpen: true });
    wx.showModal({
      title: `切换到${role === "TEACHER" ? "老师" : "家长"}版？`,
      content: "切换只会改变当前浏览与操作身份，不会自动申请、联系、发布、取消或评价任何内容。切换后仍停留在本页，请再次点击所需操作。",
      confirmText: "确认切换",
      confirmColor: "#3478f6",
      success: ({ confirm }) => {
        this.setData({ rolePromptOpen: false });
        if (confirm) this.performRoleSwitch(role);
      },
      fail: () => this.setData({ rolePromptOpen: false })
    });
  },

  async performRoleSwitch(role) {
    if (this.data.action || this.data.activeRole === role) return;
    this.setData({ action: "role" });
    try {
      const result = await getApp().switchActiveRole(role);
      this.setData({ activeRole: role, account: result.account || this.data.account });
      const refreshed = await this.loadData(false);
      wx.showToast({
        title: refreshed
          ? `已进入${role === "TEACHER" ? "老师" : "家长"}版，请再次操作`
          : "身份已切换，详情暂未刷新",
        icon: "none"
      });
    } catch (error) {
      wx.showToast({ title: error.message || "身份切换失败", icon: "none" });
    } finally {
      this.setData({ action: "" });
    }
  },

  switchViewerRole() {
    this.requestRoleSwitch(this.data.expectedViewerRole);
  },

  openMyPosts() {
    if (this.data.ownerRoleMismatch) {
      this.requestRoleSwitch(this.data.ownerRole);
      return;
    }
    wx.switchTab({ url: "/pages/publish/publish" });
  },

  onShareAppMessage() {
    const job = this.data.job;
    if (!job) return { title: "家教直聘", path: "/pages/index/index" };
    return { title: `${job.price}${job.unit}｜${job.title}`, path: `/pages/job-detail/job-detail?id=${job.id}` };
  }
});
