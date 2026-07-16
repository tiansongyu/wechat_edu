const api = require("../../utils/api");

const FILTERS = {
  district: ["全市区", "南山区", "福田区", "宝安区", "龙华区", "罗湖区", "线上"],
  grade: ["全部年级", "小学", "初中", "高中", "大学", "兴趣课"],
  settlement: ["结算方式", "课结", "日结", "周结", "月结"],
  sort: ["最新发布", "课酬从低到高", "课酬从高到低"]
};

Page({
  data: {
    loading: true,
    error: "",
    actionId: "",
    rolePromptOpen: false,
    account: null,
    accountInitial: "人",
    activeRole: "PARENT",
    roleName: "家长版",
    locationLabel: "资料未完善",
    verificationLabel: "资料未认证",
    teacherCanApply: false,
    teacherApplicationAction: "完善教师认证",
    teacherApplicationReason: "请先完善并提交教师认证资料",
    query: "",
    jobs: [],
    filteredJobs: [],
    quickSubjects: [{ label: "数学", icon: "数", active: false }, { label: "英语", icon: "英", active: false }, { label: "语文", icon: "语", active: false }, { label: "物理", icon: "物", active: false }, { label: "化学", icon: "化", active: false }, { label: "全科", icon: "全", active: false }],
    selectedSubjects: [],
    filterLabels: ["全市区", "全部年级", "结算方式", "最新发布"],
    filterOptions: [FILTERS.district, FILTERS.grade, FILTERS.settlement, FILTERS.sort],
    filterIndexes: [0, 0, 0, 0],
    resultCopy: "正在加载",
    platformOverview: null,
    platformMetricItems: [],
    platformOverviewLoading: true,
    platformOverviewError: ""
  },

  onShow() {
    this.loadData();
    this.loadPlatformOverview();
  },

  async loadPlatformOverview() {
    if (this.data.platformOverviewLoading && this.data.platformOverview) return true;
    this.setData({ platformOverviewLoading: true, platformOverviewError: "" });
    try {
      const overview = await api.getPlatformOverview();
      const metrics = overview && overview.metrics;
      if (!metrics || !Array.isArray(overview.trustHighlights)) throw new Error("平台概览数据格式异常");
      const metricDefinitions = [
        ["approvedTeachers", "认证老师", "位"],
        ["publishedJobs", "在架信息", "条"],
        ["completedAppointments", "完成合作", "次"],
        ["publishedReviews", "真实评价", "条"]
      ];
      const platformMetricItems = metricDefinitions.map(([key, label, unit]) => {
        const value = Number(metrics[key]);
        if (!Number.isFinite(value) || value < 0) throw new Error("平台概览数据格式异常");
        const displayValue = value >= 10000
          ? `${(value / 10000).toFixed(value >= 100000 ? 0 : 1).replace(/\.0$/, "")}万`
          : String(value);
        return { key, label, unit, value, displayValue };
      });
      this.setData({
        platformOverview: overview,
        platformMetricItems,
        platformOverviewLoading: false,
        platformOverviewError: ""
      });
      return true;
    } catch (error) {
      this.setData({
        platformOverview: null,
        platformMetricItems: [],
        platformOverviewLoading: false,
        platformOverviewError: error.message || "平台概览暂时加载失败"
      });
      return false;
    }
  },

  retryPlatformOverview() {
    this.loadPlatformOverview();
  },

  async loadData(showLoading = true) {
    const loadSequence = (this._loadSequence || 0) + 1;
    this._loadSequence = loadSequence;
    if (showLoading) this.setData({ loading: true, error: "" });
    try {
      // Refresh /auth/me whenever the home page becomes visible so an audit or
      // suspension performed in the admin console is reflected immediately.
      const account = await getApp().ensureAuth(true);
      const activeRole = account.activeRole || api.getActiveRole();
      const teacherProfile = account.teacherProfile || {};
      const teacherEligibility = api.getTeacherApplicationEligibility(teacherProfile);
      const type = activeRole === "TEACHER" ? "TEACHING_NEED" : "TEACHER_OFFER";
      const requests = [api.listAllJobs(this.buildJobQuery(type))];
      if (activeRole === "TEACHER") requests.push(api.listTeacherApplications());
      const [result, applications = []] = await Promise.all(requests);
      const applicationByJob = applications.reduce((map, item) => {
        map[item.jobId || (item.job && item.job.id)] = item;
        return map;
      }, {});
      const jobs = (result.items || []).map((item) => {
        const job = api.normalizeJob(item);
        const currentApplication = item.currentApplication || applicationByJob[item.id] || null;
        const canSubmitApplication = !currentApplication || currentApplication.status === "CANCELLED";
        const actionLabel = activeRole === "TEACHER" && canSubmitApplication && !teacherEligibility.canApply
          ? teacherEligibility.actionLabel
          : this.applicationLabel(currentApplication);
        return { ...job, currentApplication, actionLabel };
      });
      const parentProfile = account.parentProfile || {};
      const locationLabel = activeRole === "TEACHER"
        ? ((teacherProfile.serviceAreas || []).map((area) => area.district).filter(Boolean).join("、") || (teacherProfile.serviceDistricts || []).join("、") || "服务区域未设置")
        : [parentProfile.city, parentProfile.district].filter(Boolean).join(" · ") || "常用区域未设置";
      const verificationLabel = activeRole === "TEACHER"
        ? (!teacherProfile.submittedAt
          ? "教师资料尚未提交"
          : ({ APPROVED: "教师认证已通过", PENDING: "教师资料审核中", REJECTED: "教师资料需修改" }[teacherProfile.auditStatus] || "教师资料未完善"))
        : "家长用户";
      if (loadSequence !== this._loadSequence) return false;
      this.setData({
        account,
        accountInitial: account.nickname ? account.nickname.slice(0, 1) : "人",
        activeRole,
        roleName: activeRole === "TEACHER" ? "老师版" : "家长版",
        teacherCanApply: teacherEligibility.canApply,
        teacherApplicationAction: teacherEligibility.actionLabel,
        teacherApplicationReason: teacherEligibility.reason,
        locationLabel,
        verificationLabel,
        jobs,
        loading: false,
        error: ""
      }, () => this.applyFilters());
      return true;
    } catch (error) {
      if (loadSequence !== this._loadSequence) return false;
      this.setData({ loading: false, error: error.message || "数据加载失败", jobs: [], filteredJobs: [] });
      return false;
    }
  },

  async onPullDownRefresh() {
    await this.loadData(false);
    wx.stopPullDownRefresh();
  },

  retry() {
    this.loadData();
  },

  handleSearch(event) {
    this.setData({ query: event.detail.value });
    clearTimeout(this._searchTimer);
    this._searchTimer = setTimeout(() => this.loadData(false), 350);
  },

  clearSearch() {
    clearTimeout(this._searchTimer);
    this.setData({ query: "" }, () => this.loadData(false));
  },

  handleFilterChange(event) {
    const position = Number(event.currentTarget.dataset.position);
    const selected = Number(event.detail.value);
    const filterIndexes = this.data.filterIndexes.slice();
    const filterLabels = this.data.filterLabels.slice();
    filterIndexes[position] = selected;
    filterLabels[position] = this.data.filterOptions[position][selected];
    this.setData({ filterIndexes, filterLabels }, () => this.loadData(false));
  },

  chooseSubject(event) {
    const subject = event.currentTarget.dataset.subject;
    const selectedSubjects = this.data.selectedSubjects.includes(subject)
      ? this.data.selectedSubjects.filter((item) => item !== subject)
      : [...this.data.selectedSubjects, subject];
    const quickSubjects = this.data.quickSubjects.map((item) => ({ ...item, active: selectedSubjects.includes(item.label) }));
    this.setData({ selectedSubjects, quickSubjects }, () => this.loadData(false));
  },

  resetFilters() {
    this.setData({
      query: "",
      selectedSubjects: [],
      quickSubjects: this.data.quickSubjects.map((item) => ({ ...item, active: false })),
      filterIndexes: [0, 0, 0, 0],
      filterLabels: ["全市区", "全部年级", "结算方式", "最新发布"]
    }, () => this.loadData(false));
  },

  applyFilters() {
    const { filterIndexes, filterOptions, jobs } = this.data;
    const gradeGroup = filterOptions[1][filterIndexes[1]];
    const filteredJobs = jobs.filter((job) => {
      return gradeGroup === "全部年级" || this.matchesGrade(job.grade, gradeGroup);
    });
    this.setData({ filteredJobs, resultCopy: `${filteredJobs.length} 条匹配结果` });
  },

  buildJobQuery(type) {
    const { query, selectedSubjects, filterIndexes, filterOptions } = this.data;
    const district = filterOptions[0][filterIndexes[0]];
    const settlement = filterOptions[2][filterIndexes[2]];
    const sort = ["LATEST", "PRICE_ASC", "PRICE_DESC"][filterIndexes[3]] || "LATEST";
    return {
      type,
      keyword: query.trim() || undefined,
      subjects: selectedSubjects.length ? selectedSubjects.join(",") : undefined,
      district: district === "全市区" ? undefined : district,
      settlement: settlement === "结算方式" ? undefined : settlement,
      sort
    };
  },

  matchesGrade(grade = "", group) {
    if (group === "小学") return /小学|年级/.test(grade) && !/初|高/.test(grade);
    if (group === "初中") return /初中|^初/.test(grade);
    if (group === "高中") return /高中|^高/.test(grade);
    return grade === group;
  },

  applicationLabel(application) {
    if (!application) return "立即申请";
    return { PENDING: "申请审核中", ACCEPTED: "已被录用", REJECTED: "本次未选中", CANCELLED: "重新申请" }[application.status] || "查看申请";
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
        account: result.account || this.data.account
      });
      this.resetFilters();
      const refreshed = await this.loadData(false);
      wx.showToast({
        title: refreshed
          ? `已进入${next === "TEACHER" ? "老师" : "家长"}版`
          : "身份已切换，页面资料暂未刷新",
        icon: "none"
      });
    } catch (error) {
      wx.showToast({ title: error.message || "身份切换失败", icon: "none" });
    } finally {
      this.setData({ actionId: "" });
    }
  },

  openDetail(event) {
    wx.navigateTo({ url: `/pages/job-detail/job-detail?id=${event.currentTarget.dataset.id}` });
  },

  applyJob(event) {
    const id = event.currentTarget.dataset.id;
    const job = this.data.jobs.find((item) => item.id === id);
    if (!job) return;
    if (this.data.activeRole !== "TEACHER") {
      this.openDetail(event);
      return;
    }
    if (job.currentApplication && job.currentApplication.status !== "CANCELLED") {
      wx.showToast({ title: job.actionLabel, icon: "none" });
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
      content: `确认使用当前教师资料申请“${job.title}”？提交后可在平台内先沟通。`,
      editable: true,
      placeholderText: "可填写教学优势、可约时间或想确认的问题",
      confirmText: "提交申请",
      confirmColor: "#3478f6",
      success: async ({ confirm, content }) => {
        if (!confirm || this.data.actionId) return;
        const coverLetter = String(content || "").trim().slice(0, 1000);
        const signature = `${id}:job-apply:${coverLetter}`;
        if (!this._pendingApply || this._pendingApply.signature !== signature) {
          this._pendingApply = {
            signature,
            key: api.createCommandKey("job-apply", id)
          };
        }
        this.setData({ actionId: id });
        try {
          await api.applyJob(id, coverLetter, this._pendingApply.key);
          this._pendingApply = null;
          await this.loadData(false);
          wx.showToast({ title: "申请已提交", icon: "success" });
        } catch (error) {
          wx.showToast({ title: error.message || "申请失败", icon: "none" });
        } finally {
          this.setData({ actionId: "" });
        }
      }
    });
  },

  async toggleFavorite(event) {
    const id = event.currentTarget.dataset.id;
    const job = this.data.jobs.find((item) => item.id === id);
    if (!job || this.data.actionId) return;
    this.setData({ actionId: `favorite-${id}` });
    try {
      await api.favoriteJob(id, !job.favorite);
      await this.loadData(false);
      wx.showToast({ title: job.favorite ? "已取消收藏" : "已收藏", icon: "none" });
    } catch (error) {
      wx.showToast({ title: error.message || "收藏操作失败", icon: "none" });
    } finally {
      this.setData({ actionId: "" });
    }
  },

  goMap() { wx.switchTab({ url: "/pages/map/map" }); },
  goPublish() { wx.switchTab({ url: "/pages/publish/publish" }); },
  goProfile() {
    if (this.data.activeRole === "TEACHER") wx.navigateTo({ url: "/pages/teacher-profile/teacher-profile" });
    else wx.switchTab({ url: "/pages/profile/profile" });
  },

  onShareAppMessage(event) {
    const id = event.target && event.target.dataset && event.target.dataset.id;
    const job = this.data.jobs.find((item) => item.id === id);
    return { title: job ? `${job.price}${job.unit}｜${job.title}` : "家教直聘", path: job ? `/pages/job-detail/job-detail?id=${job.id}` : "/pages/index/index" };
  }
});
