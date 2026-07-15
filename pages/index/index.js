const { CATEGORIES, FILTERS, JOBS, findJob } = require("../../utils/data");
const store = require("../../utils/store");
const api = require("../../utils/api");

Page({
  data: {
    city: "深圳",
    districtLabel: "南山区",
    query: "",
    jobs: JOBS,
    filteredJobs: JOBS,
    categories: CATEGORIES,
    selectedRole: "",
    filterKeys: ["district", "grade", "subject", "settlement"],
    filterLabels: ["全市区", "全部年级", "全部科目", "结算方式"],
    filterOptions: [FILTERS.district, FILTERS.grade, FILTERS.subject, FILTERS.settlement],
    filterIndexes: [0, 0, 0, 0],
    appliedIds: [],
    favoriteIds: [],
    resultCopy: "82个今日新增",
    activeRole: "PARENT",
    roleName: "家长版",
    backendOnline: false
  },

  onShow() {
    const activeRole = api.getActiveRole();
    this.setData({ activeRole, roleName: activeRole === "TEACHER" ? "老师版" : "家长版" });
    this.loadLocalState();
    this.loadRemoteJobs();
  },

  async loadRemoteJobs() {
    try {
      if (getApp().globalData.authReady) await getApp().globalData.authReady;
      const type = this.data.activeRole === "TEACHER" ? "TEACHING_NEED" : "TEACHER_OFFER";
      const data = await api.listJobs({ type, limit: 50 });
      const jobs = (data.items || []).map(api.mapJob);
      this.setData({ jobs, backendOnline: true }, () => this.applyFilters());
    } catch (error) {
      this.setData({ backendOnline: false });
    }
  },

  onPullDownRefresh() {
    this.loadLocalState();
    setTimeout(() => {
      wx.stopPullDownRefresh();
      wx.showToast({ title: "已刷新好单", icon: "none" });
    }, 350);
  },

  loadLocalState() {
    const keys = getApp().globalData.storageKeys;
    this.setData({
      appliedIds: store.read(keys.applications, ["job-003"]),
      favoriteIds: store.read(keys.favorites, [])
    }, () => this.applyFilters());
  },

  handleSearch(event) {
    this.setData({ query: event.detail.value }, () => this.applyFilters());
  },

  clearSearch() {
    this.setData({ query: "" }, () => this.applyFilters());
  },

  handleFilterChange(event) {
    const position = Number(event.currentTarget.dataset.position);
    const selected = Number(event.detail.value);
    const indexes = this.data.filterIndexes.slice();
    const labels = this.data.filterLabels.slice();
    indexes[position] = selected;
    labels[position] = this.data.filterOptions[position][selected];
    this.setData({ filterIndexes: indexes, filterLabels: labels }, () => this.applyFilters());
  },

  chooseCategory(event) {
    const role = event.currentTarget.dataset.role;
    this.setData({ selectedRole: this.data.selectedRole === role ? "" : role }, () => this.applyFilters());
  },

  resetFilters() {
    this.setData({
      query: "",
      selectedRole: "",
      filterIndexes: [0, 0, 0, 0],
      filterLabels: ["全市区", "全部年级", "全部科目", "结算方式"]
    }, () => this.applyFilters());
  },

  applyFilters() {
    const { query, selectedRole, filterIndexes, filterOptions } = this.data;
    const district = filterOptions[0][filterIndexes[0]];
    const gradeGroup = filterOptions[1][filterIndexes[1]];
    const subject = filterOptions[2][filterIndexes[2]];
    const settlement = filterOptions[3][filterIndexes[3]];
    const keyword = query.trim().toLowerCase();

    const filteredJobs = this.data.jobs.filter((job) => {
      const searchable = `${job.title}${job.district}${job.area}${job.subject}${job.description}`.toLowerCase();
      const districtMatch = district === "全市区" || job.district === district;
      const gradeMatch = gradeGroup === "全部年级" || this.matchesGrade(job.grade, gradeGroup);
      const subjectMatch = subject === "全部科目" || job.subject === subject;
      const settlementMatch = settlement === "结算方式" || job.settlement === settlement;
      const roleMatch = !selectedRole || job.role === selectedRole;
      return (!keyword || searchable.includes(keyword)) && districtMatch && gradeMatch && subjectMatch && settlementMatch && roleMatch;
    }).map((job) => ({
      ...job,
      applied: this.data.appliedIds.includes(job.id),
      favorite: this.data.favoriteIds.includes(job.id)
    }));

    this.setData({
      filteredJobs,
      resultCopy: filteredJobs.length ? `${filteredJobs.length}个匹配好单` : "换个条件试试"
    });
  },

  switchRole() {
    const next = this.data.activeRole === "TEACHER" ? "PARENT" : "TEACHER";
    wx.showLoading({ title: "切换中" });
    api.switchRole(next)
      .catch((error) => {
        if (!error.network) throw error;
        wx.setStorageSync("tutor_link_active_role", next);
      })
      .then(() => {
        getApp().globalData.activeRole = next;
        this.setData({
          activeRole: next,
          roleName: next === "TEACHER" ? "老师版" : "家长版",
          jobs: JOBS
        }, () => {
          this.loadRemoteJobs();
          this.applyFilters();
        });
        wx.showToast({ title: `已进入${next === "TEACHER" ? "老师" : "家长"}版`, icon: "none" });
      })
      .catch((error) => wx.showToast({ title: error.message || "切换失败", icon: "none" }))
      .finally(() => wx.hideLoading());
  },

  matchesGrade(grade, group) {
    if (group === "小学") return /年级/.test(grade) && !/初|高/.test(grade);
    if (group === "初中") return /^初/.test(grade);
    if (group === "高中") return /^高/.test(grade);
    return grade === group;
  },

  openDetail(event) {
    wx.navigateTo({ url: `/pages/job-detail/job-detail?id=${event.currentTarget.dataset.id}` });
  },

  applyJob(event) {
    const id = event.currentTarget.dataset.id;
    const job = this.data.jobs.find((item) => item.id === id) || findJob(id);
    if (!job) return;
    if (this.data.appliedIds.includes(id)) {
      wx.showToast({ title: "申请资料正在审核", icon: "none" });
      return;
    }

    if (this.data.activeRole !== "TEACHER") {
      wx.navigateTo({ url: `/pages/job-detail/job-detail?id=${id}` });
      return;
    }
    wx.showModal({
      title: "确认申请",
      content: `将使用已认证资料申请“${job.title}”，提交后可在“我的”查看进度。`,
      confirmText: "提交申请",
      confirmColor: "#3478f6",
      success: async ({ confirm }) => {
        if (!confirm) return;
        try {
          if (this.data.backendOnline) await api.applyJob(id);
          const key = getApp().globalData.storageKeys.applications;
          const appliedIds = store.appendUnique(key, id);
          this.setData({ appliedIds }, () => this.applyFilters());
          wx.showToast({ title: "申请已提交", icon: "success" });
        } catch (error) {
          wx.showToast({ title: error.message || "申请失败", icon: "none" });
        }
      }
    });
  },

  toggleFavorite(event) {
    const key = getApp().globalData.storageKeys.favorites;
    const id = event.currentTarget.dataset.id;
    const favoriteIds = store.toggleInList(key, id);
    const added = favoriteIds.includes(id);
    this.setData({ favoriteIds }, () => this.applyFilters());
    if (this.data.backendOnline) api.favoriteJob(id, added).catch(() => {});
    wx.showToast({ title: added ? "已收藏" : "已取消收藏", icon: "none" });
  },

  goMap() {
    wx.redirectTo({ url: "/pages/map/map" });
  },

  goPublish() {
    wx.redirectTo({ url: "/pages/publish/publish" });
  },

  viewCredit() {
    wx.showModal({
      title: "信誉值 92",
      content: "实名认证 +40\n教育经历 +20\n申请履约记录 +32\n\n再完善一项教学经历，可提升曝光排序。",
      showCancel: false,
      confirmText: "知道了",
      confirmColor: "#3478f6"
    });
  },

  followAccount() {
    wx.showToast({ title: "已记录关注提醒", icon: "success" });
  },

  joinGroup() {
    wx.showToast({ title: "群申请已提交", icon: "none" });
  },

  onShareAppMessage(event) {
    const id = event.target && event.target.dataset ? event.target.dataset.id : "";
    const job = this.data.jobs.find((item) => item.id === id) || findJob(id);
    return {
      title: job ? `${job.price}${job.unit}｜${job.title}` : "深圳靠谱家教好单每日更新",
      path: job ? `/pages/job-detail/job-detail?id=${job.id}` : "/pages/index/index"
    };
  }
});
