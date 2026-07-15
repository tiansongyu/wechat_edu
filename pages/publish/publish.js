const store = require("../../utils/store");
const api = require("../../utils/api");

const EMPTY_FORM = {
  title: "",
  district: "",
  grade: "",
  subject: "",
  price: "",
  schedule: "",
  description: "",
  contact: ""
};

Page({
  data: {
    publishType: "offer",
    form: { ...EMPTY_FORM },
    districts: ["南山区", "福田区", "宝安区", "龙华区", "罗湖区", "线上"],
    grades: ["小学", "初中", "高中", "大学", "兴趣课"],
    subjects: ["数学", "英语", "语文", "物理", "化学", "全科", "编程", "其他"],
    districtIndex: -1,
    gradeIndex: -1,
    subjectIndex: -1,
    posts: [],
    activeRole: "PARENT",
    roleName: "家长版"
  },

  onShow() {
    const key = getApp().globalData.storageKeys.posts;
    const posts = store.read(key, []);
    const activeRole = api.getActiveRole();
    this.setData({
      posts: Array.isArray(posts) ? posts : [],
      activeRole,
      roleName: activeRole === "TEACHER" ? "老师版" : "家长版",
      publishType: activeRole === "TEACHER" ? "offer" : "need"
    });
    this.loadRemotePosts();
  },

  async loadRemotePosts() {
    try {
      if (getApp().globalData.authReady) await getApp().globalData.authReady;
      const posts = await api.request("/api/v1/jobs/mine");
      this.setData({ posts: posts.map((item) => ({
        ...item,
        price: item.priceCents / 100,
        unit: `/${item.priceUnit}`,
        createdLabel: new Date(item.createdAt).toLocaleDateString(),
        status: { PENDING: "审核中", PUBLISHED: "已发布", REJECTED: "需修改", CLOSED: "已关闭" }[item.status] || item.status
      })) });
    } catch (error) {}
  },

  switchType(event) {
    const expected = this.data.activeRole === "TEACHER" ? "offer" : "need";
    if (event.currentTarget.dataset.type !== expected) {
      wx.showToast({ title: `请先到“我的”切换${expected === "offer" ? "老师" : "家长"}版`, icon: "none" });
      return;
    }
    this.setData({ publishType: expected });
  },

  handleInput(event) {
    const field = event.currentTarget.dataset.field;
    this.setData({ [`form.${field}`]: event.detail.value });
  },

  handlePicker(event) {
    const field = event.currentTarget.dataset.field;
    const index = Number(event.detail.value);
    const range = this.data[`${field}s`];
    this.setData({
      [`${field}Index`]: index,
      [`form.${field}`]: range[index]
    });
  },

  submitForm() {
    const form = this.data.form;
    const required = ["title", "district", "grade", "subject", "price", "schedule", "description", "contact"];
    if (required.some((field) => !String(form[field] || "").trim())) {
      wx.showToast({ title: "请把必填信息补充完整", icon: "none" });
      return;
    }
    if (!/^1\d{10}$/.test(form.contact) && !/^[a-zA-Z][-_a-zA-Z0-9]{5,19}$/.test(form.contact)) {
      wx.showToast({ title: "请填写手机号或微信号", icon: "none" });
      return;
    }

    wx.showModal({
      title: "确认发布",
      content: "平台会隐藏你的联系方式，双方确认后才会互相可见。提交后预计 30 分钟内完成审核。",
      confirmText: "提交审核",
      confirmColor: "#3478f6",
      success: async ({ confirm }) => {
        if (!confirm) return;
        wx.showLoading({ title: "提交中" });
        try {
          let serverPost = null;
          try {
            if (getApp().globalData.authReady) await getApp().globalData.authReady;
            serverPost = await api.createJob(form, this.data.publishType);
          } catch (error) {
            if (!error.network) throw error;
          }
          const post = {
            ...form,
            id: serverPost ? serverPost.id : `post-${Date.now()}`,
            type: this.data.publishType,
            status: "审核中",
            createdAt: Date.now(),
            createdLabel: "刚刚"
          };
          const posts = [post].concat(this.data.posts.filter((item) => item.id !== post.id));
          store.write(getApp().globalData.storageKeys.posts, posts);
          this.setData({ posts, form: { ...EMPTY_FORM }, districtIndex: -1, gradeIndex: -1, subjectIndex: -1 });
          wx.showToast({ title: "已提交审核", icon: "success" });
        } catch (error) {
          wx.showToast({ title: error.message || "提交失败", icon: "none" });
        } finally {
          wx.hideLoading();
        }
      }
    });
  },

  removePost(event) {
    const id = event.currentTarget.dataset.id;
    wx.showModal({
      title: "撤回发布",
      content: "撤回后该信息将不再进入审核。",
      confirmText: "确认撤回",
      confirmColor: "#e75f58",
      success: ({ confirm }) => {
        if (!confirm) return;
        const posts = this.data.posts.filter((item) => item.id !== id);
        store.write(getApp().globalData.storageKeys.posts, posts);
        this.setData({ posts });
      }
    });
  }
});
