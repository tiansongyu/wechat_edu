const api = require("../../utils/api");

const STARS = [1, 2, 3, 4, 5];
const REVIEW_TAGS = {
  PARENT: ["专业耐心", "表达清楚", "准时守约", "沟通顺畅", "认真负责"],
  TEACHER: ["需求清晰", "沟通顺畅", "准时守约", "尊重老师", "配合积极"]
};
const RATING_HINTS = {
  1: "体验不佳，请具体说明遇到的问题",
  2: "有待改善，请留下真实建议",
  3: "整体尚可，还有提升空间",
  4: "合作愉快，值得推荐",
  5: "非常满意，是一次很棒的合作"
};

function emptySummary() {
  return {
    displayAverage: null,
    count: 0,
    distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    level: "NEW",
    levelLabel: "评价积累中"
  };
}

function formatReview(item) {
  const rating = Number(item.rating || 0);
  return {
    ...item,
    tags: Array.isArray(item.tags) ? item.tags : [],
    stars: STARS.map((value) => ({ value, filled: value <= rating })),
    createdLabel: api.formatDate(item.createdAt),
    content: item.content || "这位用户选择了星级和标签，没有补充文字。"
  };
}

Page({
  data: {
    loading: true,
    loadingMore: false,
    submitting: false,
    switchingRole: false,
    error: "",
    formError: "",
    appointmentId: "",
    accountId: "",
    receivedMode: false,
    account: null,
    appointment: null,
    target: null,
    targetRole: "TEACHER",
    pageTitle: "合作评价",
    summary: emptySummary(),
    reviews: [],
    nextCursor: "",
    rating: 0,
    stars: STARS,
    ratingHint: "请点亮星星，留下你的真实感受",
    tagOptions: [],
    selectedTags: [],
    content: "",
    contentLength: 0,
    submissionKey: "",
    submittedReview: null,
    reputationError: "",
    reputationRetryable: false,
    requiredRole: ""
  },

  onLoad(options) {
    const appointmentId = options.appointmentId || "";
    const accountId = options.accountId || "";
    const receivedMode = options.received === "1";
    this.setData({ appointmentId, accountId, receivedMode });
    this.loadData();
  },

  async onPullDownRefresh() {
    await this.loadData(false);
    wx.stopPullDownRefresh();
  },

  async loadData(showLoading = true) {
    if (showLoading) this.setData({ loading: true, error: "" });
    try {
      const account = await getApp().ensureAuth();
      if (this.data.appointmentId) {
        await this.loadAppointment(account);
      } else if (this.data.receivedMode) {
        const result = await api.listMyReceivedReviews({ limit: 20 });
        this.applyReviewResult(result, {
          account,
          pageTitle: account.activeRole === "TEACHER" ? "我的教师评价" : "我的家长评价",
          targetRole: result.targetRole || account.activeRole
        });
      } else if (this.data.accountId) {
        const result = await api.listTeacherReviews(this.data.accountId, { limit: 20 });
        this.applyReviewResult(result, {
          account,
          pageTitle: "老师口碑",
          targetRole: "TEACHER"
        });
      } else {
        throw new Error("缺少评价对象，请返回上一页重试");
      }
    } catch (error) {
      this.setData({
        loading: false,
        error: error.message || "评价加载失败",
        reviews: [],
        nextCursor: ""
      });
    }
  },

  async loadAppointment(account) {
    const appointments = await api.listAppointments();
    const appointment = appointments.find((item) => item.id === this.data.appointmentId);
    if (!appointment) throw new Error("没有找到这次合作预约");

    const target = appointment.reviewTarget || null;
    const activeRole = account.activeRole || api.getActiveRole();
    const tags = REVIEW_TAGS[activeRole] || [];
    let reputation = { summary: emptySummary(), items: [], nextCursor: "" };
    let reputationError = "";
    let reputationRetryable = false;
    let requiredRole = "";
    try {
      reputation = await api.getCounterpartReputation(appointment.id);
    } catch (error) {
      const code = error.data && error.data.code;
      if (code === "ROLE_SWITCH_REQUIRED") {
        requiredRole = error.data.requiredRole || "";
        reputationError = error.message || "请切换到本次合作使用的身份";
      } else if (code === "REPUTATION_CONTEXT_UNAVAILABLE" || error.statusCode === 403) {
        reputationError = error.message || "当前预约状态不能查看对方评价";
      } else {
        reputationError = error.message || "对方口碑暂时加载失败";
        reputationRetryable = true;
      }
    }
    if (!reputationError && target && target.role === "TEACHER") {
      try {
        const publicResult = await api.listTeacherReviews(target.accountId, { limit: 20 });
        reputation = { ...reputation, ...publicResult, summary: reputation.summary || publicResult.summary };
      } catch (error) {
        reputationError = error.message || "老师的公开评价暂时加载失败";
        reputationRetryable = true;
      }
    }

    const submittedReview = appointment.myReview ? formatReview(appointment.myReview) : null;
    const rawTargetLabel = target && typeof target.label === "string" && target.label.trim()
      ? target.label.trim()
      : target && target.role === "PARENT"
        ? "家长"
        : "老师";
    const targetLabel = rawTargetLabel.replace("本次合作", "");
    this.setData({
      account,
      appointment,
      target,
      targetRole: target ? target.role : "TEACHER",
      pageTitle: target ? `评价${targetLabel}` : "合作评价",
      summary: reputation.summary || emptySummary(),
      reviews: (reputation.items || []).map(formatReview),
      nextCursor: reputation.nextCursor || "",
      tagOptions: tags.map((label) => ({ label, selected: this.data.selectedTags.includes(label) })),
      submittedReview,
      reputationError,
      reputationRetryable,
      requiredRole,
      loading: false,
      error: ""
    });
    wx.setNavigationBarTitle({ title: target ? `评价${target.role === "TEACHER" ? "老师" : "家长"}` : "合作评价" });
  },

  applyReviewResult(result, extra = {}) {
    this.setData({
      ...extra,
      summary: result.summary || emptySummary(),
      reviews: (result.items || []).map(formatReview),
      nextCursor: result.nextCursor || "",
      loading: false,
      error: ""
    });
    if (extra.pageTitle) wx.setNavigationBarTitle({ title: extra.pageTitle });
  },

  retry() {
    this.loadData();
  },

  selectRating(event) {
    if (this.data.submitting || this.data.submittedReview) return;
    const rating = Number(event.currentTarget.dataset.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) return;
    this.setData({
      rating,
      ratingHint: RATING_HINTS[rating],
      formError: ""
    });
  },

  toggleTag(event) {
    if (this.data.submitting || this.data.submittedReview) return;
    const label = event.currentTarget.dataset.label;
    const selected = this.data.selectedTags.includes(label);
    if (!selected && this.data.selectedTags.length >= 5) {
      wx.showToast({ title: "最多选择5个标签", icon: "none" });
      return;
    }
    const selectedTags = selected
      ? this.data.selectedTags.filter((item) => item !== label)
      : [...this.data.selectedTags, label];
    this.setData({
      selectedTags,
      tagOptions: this.data.tagOptions.map((item) => ({
        ...item,
        selected: selectedTags.includes(item.label)
      })),
      formError: ""
    });
  },

  handleContentInput(event) {
    if (this.data.submitting || this.data.submittedReview) return;
    const content = event.detail.value || "";
    this.setData({
      content,
      contentLength: Array.from(content).length,
      formError: ""
    });
  },

  switchRequiredRole() {
    const role = this.data.requiredRole;
    if (!role || this.data.switchingRole || this.data.submitting) return;
    wx.showModal({
      title: "切换合作身份",
      content: `这次合作使用的是${role === "TEACHER" ? "老师" : "家长"}身份。切换后只会重新加载评价，不会自动提交任何内容。`,
      confirmText: "确认切换",
      confirmColor: "#3478f6",
      success: async ({ confirm }) => {
        if (!confirm || this.data.switchingRole) return;
        this.setData({ switchingRole: true });
        try {
          await api.switchRole(role);
          getApp().globalData.activeRole = role;
          getApp().globalData.account = null;
          getApp().globalData.authReady = null;
          await getApp().ensureAuth(true);
          await this.loadData(false);
          wx.showToast({ title: `已进入${role === "TEACHER" ? "老师" : "家长"}版`, icon: "none" });
        } catch (error) {
          wx.showToast({ title: error.message || "身份切换失败", icon: "none" });
        } finally {
          this.setData({ switchingRole: false });
        }
      }
    });
  },

  validateReview() {
    const { rating, selectedTags, content } = this.data;
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) return "请选择1到5星评价";
    if (selectedTags.length > 5) return "评价标签最多选择5个";
    if (Array.from(content).length > 500) return "评价内容不能超过500字";
    if (rating <= 2 && Array.from(content.replace(/\s/g, "")).length < 10) {
      return "1至2星评价请填写不少于10字的具体说明";
    }
    return "";
  },

  async submitReview() {
    if (this.data.submitting || this.data.submittedReview || !this.data.appointment) return;
    if (!this.data.appointment.canReview) {
      wx.showToast({ title: "当前预约暂不可评价", icon: "none" });
      return;
    }
    const formError = this.validateReview();
    if (formError) {
      this.setData({ formError });
      wx.showToast({ title: formError, icon: "none" });
      return;
    }

    const submissionKey = this.data.submissionKey
      || `review-${this.data.appointmentId}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    this.setData({ submitting: true, formError: "", submissionKey });
    try {
      const review = await api.createReview(this.data.appointmentId, {
        rating: this.data.rating,
        tags: this.data.selectedTags,
        content: this.data.content
      }, submissionKey);
      this.setData({
        submittedReview: formatReview(review),
        "appointment.canReview": false,
        "appointment.myReview": review,
        submitting: false,
        submissionKey: ""
      });
      try {
        let refreshed = await api.getCounterpartReputation(this.data.appointmentId);
        if (this.data.target && this.data.target.role === "TEACHER") {
          const publicResult = await api.listTeacherReviews(this.data.target.accountId, { limit: 20 });
          refreshed = { ...refreshed, ...publicResult, summary: refreshed.summary || publicResult.summary };
        }
        this.setData({
          summary: refreshed.summary || this.data.summary,
          reviews: (refreshed.items || []).map(formatReview),
          nextCursor: refreshed.nextCursor || "",
          reputationError: "",
          reputationRetryable: false,
          requiredRole: ""
        });
      } catch (refreshError) {
        this.setData({
          reputationError: "评价已保存，最新口碑暂时没有刷新，请稍后下拉重试",
          reputationRetryable: true
        });
      }
      wx.showToast({ title: "评价已送达", icon: "success" });
    } catch (error) {
      this.setData({
        submitting: false,
        formError: error.message || "提交失败，请检查后重试"
      });
    }
  },

  async loadMore() {
    if (this.data.loadingMore || !this.data.nextCursor) return;
    const canLoadTeacherReviews = Boolean(
      this.data.accountId || (this.data.target && this.data.target.role === "TEACHER" && this.data.target.accountId)
    );
    if (!this.data.receivedMode && !canLoadTeacherReviews) return;
    this.setData({ loadingMore: true });
    try {
      const params = { cursor: this.data.nextCursor, limit: 20 };
      const result = this.data.receivedMode
        ? await api.listMyReceivedReviews(params)
        : await api.listTeacherReviews(this.data.accountId || this.data.target.accountId, params);
      this.setData({
        reviews: [...this.data.reviews, ...(result.items || []).map(formatReview)],
        nextCursor: result.nextCursor || ""
      });
    } catch (error) {
      wx.showToast({ title: error.message || "加载更多失败", icon: "none" });
    } finally {
      this.setData({ loadingMore: false });
    }
  }
});
