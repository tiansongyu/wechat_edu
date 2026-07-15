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
const REPORT_CATEGORIES = [
  { value: "PRIVACY_LEAK", label: "泄露隐私", icon: "⌁" },
  { value: "HARASSMENT", label: "辱骂骚扰", icon: "!" },
  { value: "FALSE_INFORMATION", label: "虚假内容", icon: "?" },
  { value: "ADVERTISING", label: "广告导流", icon: "↗" },
  { value: "OTHER", label: "其他问题", icon: "…" }
];
const REPORT_STATUS = {
  OPEN: { label: "平台处理中", tone: "pending" },
  ACTION_TAKEN: { label: "已采取措施", tone: "resolved" },
  NO_VIOLATION: { label: "未发现违规", tone: "neutral" }
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
  const governance = {
    HIDDEN: { label: "平台复核中", copy: "这条评价暂不公开，也不会计入星级汇总。" },
    REMOVED: { label: "已停止展示", copy: "这条评价已由平台停止公开，原始记录仍会保留。" },
    PUBLISHED: { label: "评价已保存", copy: "评价已经保存，双方的每次真诚合作都在让平台变得更可靠。" }
  }[item.status] || { label: "评价已保存", copy: "评价记录已经安全保存。" };
  return {
    ...item,
    tags: Array.isArray(item.tags) ? item.tags : [],
    stars: STARS.map((value) => ({ value, filled: value <= rating })),
    createdLabel: api.formatDate(item.createdAt),
    content: item.content || "这位用户选择了星级和标签，没有补充文字。",
    governanceLabel: governance.label,
    governanceCopy: governance.copy
  };
}

function formatReport(item) {
  const meta = REPORT_STATUS[item.status] || { label: "状态更新中", tone: "pending" };
  return {
    ...item,
    statusLabel: meta.label,
    statusTone: meta.tone,
    categoryLabel: (REPORT_CATEGORIES.find((entry) => entry.value === item.category) || {}).label || "其他问题",
    createdLabel: api.formatDate(item.createdAt),
    resolvedLabel: item.resolvedAt ? api.formatDate(item.resolvedAt) : ""
  };
}

function attachReports(reviews, reportsByReview) {
  return reviews.map((item) => ({ ...item, report: reportsByReview[item.id] || null }));
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
    requiredRole: "",
    reportsByReview: {},
    reviewReports: [],
    reportHistoryUnavailable: false,
    showReportSheet: false,
    reportReviewId: "",
    existingReport: null,
    reportCategoryOptions: REPORT_CATEGORIES,
    reportCategory: "",
    reportDescription: "",
    reportDescriptionLength: 0,
    reportError: "",
    reportSubmissionKey: "",
    submittingReport: false
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
        const [result, reportResult] = await Promise.all([
          api.listMyReceivedReviews({ limit: 20 }),
          api.listMyReviewReports({ limit: 100 }).catch(() => ({ unavailable: true, items: [] }))
        ]);
        const reviewReports = (reportResult.items || []).map(formatReport);
        const reportsByReview = reviewReports.reduce((resultMap, report) => {
          resultMap[report.reviewId] = report;
          return resultMap;
        }, {});
        this.applyReviewResult(result, {
          account,
          pageTitle: account.activeRole === "TEACHER" ? "我的教师评价" : "我的家长评价",
          targetRole: result.targetRole || account.activeRole,
          reportsByReview,
          reviewReports,
          reportHistoryUnavailable: Boolean(reportResult.unavailable)
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
      return true;
    } catch (error) {
      this.setData({
        loading: false,
        error: error.message || "评价加载失败",
        reviews: [],
        nextCursor: ""
      });
      return false;
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
    const reportsByReview = extra.reportsByReview || this.data.reportsByReview || {};
    this.setData({
      ...extra,
      summary: result.summary || emptySummary(),
      reviews: attachReports((result.items || []).map(formatReview), reportsByReview),
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
      content: `这次合作使用的是${role === "TEACHER" ? "老师" : "家长"}身份。切换只会改变当前身份，不会自动申请、联系、发布、取消或评价任何内容。`,
      confirmText: "确认切换",
      confirmColor: "#3478f6",
      success: async ({ confirm }) => {
        if (!confirm || this.data.switchingRole) return;
        this.setData({ switchingRole: true });
        try {
          const result = await getApp().switchActiveRole(role);
          this.setData({ account: result.account || this.data.account });
          const refreshed = await this.loadData(false);
          wx.showToast({
            title: refreshed
              ? `已进入${role === "TEACHER" ? "老师" : "家长"}版`
              : "身份已切换，评价资料暂未刷新",
            icon: "none"
          });
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

  openReport(event) {
    if (!this.data.receivedMode || this.data.submittingReport) return;
    const reviewId = String(event.currentTarget.dataset.reviewId || "");
    if (!reviewId) return;
    const existingReport = this.data.reportsByReview[reviewId] || null;
    this.setData({
      showReportSheet: true,
      reportReviewId: reviewId,
      existingReport,
      reportCategory: "",
      reportDescription: "",
      reportDescriptionLength: 0,
      reportError: "",
      reportSubmissionKey: ""
    });
  },

  closeReportSheet() {
    if (this.data.submittingReport) return;
    this.setData({ showReportSheet: false, reportError: "" });
  },

  preventReportClose() {},

  selectReportCategory(event) {
    if (this.data.submittingReport || this.data.existingReport) return;
    const category = String(event.currentTarget.dataset.category || "");
    if (!REPORT_CATEGORIES.some((item) => item.value === category)) return;
    this.setData({ reportCategory: category, reportError: "", reportSubmissionKey: "" });
  },

  handleReportDescription(event) {
    if (this.data.submittingReport || this.data.existingReport) return;
    const reportDescription = event.detail.value || "";
    this.setData({
      reportDescription,
      reportDescriptionLength: Array.from(reportDescription).length,
      reportError: "",
      reportSubmissionKey: ""
    });
  },

  validateReport() {
    if (!REPORT_CATEGORIES.some((item) => item.value === this.data.reportCategory)) return "请选择问题类型";
    const description = String(this.data.reportDescription || "").trim();
    const length = Array.from(description).length;
    if (length < 10) return "请至少填写10个字，帮助平台准确核查";
    if (length > 500) return "问题说明不能超过500字";
    return "";
  },

  async submitReport() {
    if (this.data.submittingReport || this.data.existingReport || !this.data.reportReviewId) return;
    const reportError = this.validateReport();
    if (reportError) {
      this.setData({ reportError });
      wx.showToast({ title: reportError, icon: "none" });
      return;
    }
    const reportSubmissionKey = this.data.reportSubmissionKey
      || `review-report-${this.data.reportReviewId}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    this.setData({ submittingReport: true, reportError: "", reportSubmissionKey });
    try {
      const result = await api.reportReview(this.data.reportReviewId, {
        category: this.data.reportCategory,
        description: this.data.reportDescription
      }, reportSubmissionKey);
      const report = formatReport(result);
      const reportsByReview = { ...this.data.reportsByReview, [report.reviewId]: report };
      const reviewReports = [
        report,
        ...this.data.reviewReports.filter((item) => item.reviewId !== report.reviewId)
      ];
      this.setData({
        reportsByReview,
        reviewReports,
        reviews: attachReports(this.data.reviews, reportsByReview),
        existingReport: report,
        submittingReport: false,
        reportSubmissionKey: ""
      });
      wx.showToast({ title: "举报已提交", icon: "success" });
    } catch (error) {
      this.setData({
        submittingReport: false,
        reportError: error.message || "提交失败，请检查后重试"
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
        reviews: [...this.data.reviews, ...attachReports((result.items || []).map(formatReview), this.data.reportsByReview)],
        nextCursor: result.nextCursor || ""
      });
    } catch (error) {
      wx.showToast({ title: error.message || "加载更多失败", icon: "none" });
    } finally {
      this.setData({ loadingMore: false });
    }
  }
});
