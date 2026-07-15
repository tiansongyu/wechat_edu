const { JOBS } = require("../../utils/data");
const store = require("../../utils/store");
const api = require("../../utils/api");

Page({
  data: {
    activePanel: "applications",
    applications: [],
    favorites: [],
    posts: [],
    visibleItems: [],
    panelTitle: "我的申请",
    settings: {
      jobNotice: true,
      chatNotice: true,
      privacyMode: true
    },
    showSettings: false,
    activeRole: "PARENT",
    roleName: "家长版",
    account: null
  },

  onShow() {
    const activeRole = api.getActiveRole();
    this.setData({ activeRole, roleName: activeRole === "TEACHER" ? "老师版" : "家长版" });
    this.loadData();
    this.loadRemoteData();
  },

  async loadRemoteData() {
    try {
      if (getApp().globalData.authReady) await getApp().globalData.authReady;
      const [account, posts, applications] = await Promise.all([
        api.request("/api/v1/auth/me"),
        api.request("/api/v1/jobs/mine"),
        this.data.activeRole === "TEACHER" ? api.request("/api/v1/teacher/applications") : Promise.resolve([])
      ]);
      this.setData({
        account,
        posts: posts.map((item) => api.mapJob({ ...item, status: item.status })),
        applications: applications.map((item) => ({ ...api.mapJob(item.job), status: { PENDING: "待处理", ACCEPTED: "已录用", REJECTED: "未选中" }[item.status] || item.status }))
      }, () => this.applyPanel());
    } catch (error) {}
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
        this.setData({ activeRole: next, roleName: next === "TEACHER" ? "老师版" : "家长版" });
        this.loadData();
        this.loadRemoteData();
        wx.showToast({ title: `已进入${next === "TEACHER" ? "老师" : "家长"}版`, icon: "none" });
      })
      .catch((error) => wx.showToast({ title: error.message || "切换失败", icon: "none" }))
      .finally(() => wx.hideLoading());
  },

  loadData() {
    const keys = getApp().globalData.storageKeys;
    const appliedIds = store.read(keys.applications, ["job-003"]);
    const favoriteIds = store.read(keys.favorites, []);
    const posts = store.read(keys.posts, []);
    const settings = store.read(keys.settings, this.data.settings);
    const applications = JOBS.filter((job) => appliedIds.includes(job.id)).map((job) => ({ ...job, status: "审核中" }));
    const favorites = JOBS.filter((job) => favoriteIds.includes(job.id));
    this.setData({
      applications,
      favorites,
      posts: Array.isArray(posts) ? posts : [],
      settings: { ...this.data.settings, ...(settings || {}) }
    }, () => this.applyPanel());
  },

  selectPanel(event) {
    this.setData({ activePanel: event.currentTarget.dataset.panel, showSettings: false }, () => this.applyPanel());
  },

  applyPanel() {
    const panel = this.data.activePanel;
    const map = {
      applications: { title: "我的申请", items: this.data.applications },
      favorites: { title: "我的收藏", items: this.data.favorites },
      posts: { title: "我的发布", items: this.data.posts }
    };
    this.setData({ panelTitle: map[panel].title, visibleItems: map[panel].items });
  },

  openItem(event) {
    const id = event.currentTarget.dataset.id;
    if (!String(id).startsWith("post-")) {
      wx.navigateTo({ url: `/pages/job-detail/job-detail?id=${id}` });
      return;
    }
    wx.showToast({ title: "该发布正在平台审核", icon: "none" });
  },

  improveProfile() {
    if (this.data.activeRole === "TEACHER") {
      wx.navigateTo({ url: "/pages/teacher-profile/teacher-profile" });
      return;
    }
    wx.showModal({
      title: "完善家长资料",
      content: "补充所在区域和常用授课地址，可以获得更准确的老师推荐。",
      confirmText: "知道了",
      confirmColor: "#3478f6",
      showCancel: false
    });
  },

  showCredit() {
    wx.showModal({
      title: "信誉分明细",
      content: "实名认证 40分\n教育经历 20分\n活跃与履约 32分\n\n当前信誉等级：优秀",
      showCancel: false,
      confirmColor: "#3478f6"
    });
  },

  toggleSettings() {
    this.setData({ showSettings: !this.data.showSettings });
  },

  updateSetting(event) {
    const field = event.currentTarget.dataset.field;
    const settings = { ...this.data.settings, [field]: event.detail.value };
    store.write(getApp().globalData.storageKeys.settings, settings);
    this.setData({ settings });
  },

  contactSupport() {
    wx.showModal({
      title: "平台客服",
      content: "服务时间：09:00–21:00\n常见问题可在消息中心查看，紧急问题请联系平台顾问。",
      showCancel: false,
      confirmText: "知道了",
      confirmColor: "#3478f6"
    });
  }
});
