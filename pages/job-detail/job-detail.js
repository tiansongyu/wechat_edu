const { findJob } = require("../../utils/data");
const store = require("../../utils/store");
const api = require("../../utils/api");

Page({
  data: {
    job: null,
    applied: false,
    favorite: false,
    jobId: "",
    backendOnline: false,
    activeRole: "PARENT"
  },

  onLoad(options) {
    const job = findJob(options.id) || null;
    this.setData({ job, jobId: options.id, activeRole: api.getActiveRole() });
    wx.setNavigationBarTitle({ title: job ? job.title.slice(0, 10) : "家教单详情" });
    this.loadRemoteJob();
  },

  async loadRemoteJob() {
    try {
      if (getApp().globalData.authReady) await getApp().globalData.authReady;
      const item = await api.request(`/api/v1/jobs/${this.data.jobId}`);
      const job = api.mapJob(item);
      this.setData({ job, backendOnline: true, favorite: item.favorite });
      wx.setNavigationBarTitle({ title: job.title.slice(0, 10) });
    } catch (error) {
      if (!this.data.job) this.setData({ job: findJob("job-001") });
    }
  },

  onShow() {
    if (!this.data.job) return;
    const keys = getApp().globalData.storageKeys;
    const appliedIds = store.read(keys.applications, ["job-003"]);
    const favoriteIds = store.read(keys.favorites, []);
    this.setData({
      applied: appliedIds.includes(this.data.job.id),
      favorite: favoriteIds.includes(this.data.job.id)
    });
  },

  applyJob() {
    if (this.data.activeRole !== "TEACHER") {
      wx.showToast({ title: "请先切换到老师版", icon: "none" });
      return;
    }
    if (this.data.applied) {
      wx.showModal({
        title: "申请审核中",
        content: "平台正在核验你的资料，审核结果会通过消息中心通知。",
        showCancel: false,
        confirmText: "知道了",
        confirmColor: "#3478f6"
      });
      return;
    }
    wx.showModal({
      title: "确认申请",
      content: "提交后平台顾问会联系你核对教学经历，请保持消息通知开启。",
      confirmText: "提交申请",
      confirmColor: "#3478f6",
      success: async ({ confirm }) => {
        if (!confirm) return;
        try {
          if (this.data.backendOnline) await api.applyJob(this.data.job.id);
          store.appendUnique(getApp().globalData.storageKeys.applications, this.data.job.id);
          this.setData({ applied: true });
          wx.showToast({ title: "申请已提交", icon: "success" });
        } catch (error) {
          wx.showToast({ title: error.message || "申请失败", icon: "none" });
        }
      }
    });
  },

  toggleFavorite() {
    const favoriteIds = store.toggleInList(getApp().globalData.storageKeys.favorites, this.data.job.id);
    const favorite = favoriteIds.includes(this.data.job.id);
    this.setData({ favorite });
    if (this.data.backendOnline) api.favoriteJob(this.data.job.id, favorite).catch(() => {});
    wx.showToast({ title: favorite ? "已收藏" : "已取消收藏", icon: "none" });
  },

  contactPublisher() {
    if (this.data.activeRole === "PARENT" && this.data.job.type === "TEACHER_OFFER") {
      wx.showModal({
        title: "联系老师",
        content: "平台会建立受保护的会话，匹配确认前不会展示双方联系方式。",
        confirmText: "开始沟通",
        confirmColor: "#3478f6",
        success: async ({ confirm }) => {
          if (!confirm) return;
          try {
            if (this.data.backendOnline && this.data.job.owner && this.data.job.owner.id) {
              await api.request("/api/v1/conversations", { method: "POST", data: { memberId: this.data.job.owner.id } });
            }
            wx.redirectTo({ url: "/pages/messages/messages" });
          } catch (error) {
            wx.showToast({ title: error.message || "暂时无法建立会话", icon: "none" });
          }
        }
      });
      return;
    }
    wx.showModal({
      title: "联系发布人",
      content: "为保护双方隐私，提交申请并通过初审后即可进入平台沟通。",
      confirmText: this.data.applied ? "去看消息" : "先提交申请",
      confirmColor: "#3478f6",
      success: ({ confirm }) => {
        if (!confirm) return;
        if (this.data.applied) wx.redirectTo({ url: "/pages/messages/messages" });
        else this.applyJob();
      }
    });
  },

  onShareAppMessage() {
    const job = this.data.job;
    return {
      title: `${job.price}${job.unit}｜${job.title}`,
      path: `/pages/job-detail/job-detail?id=${job.id}`
    };
  }
});
