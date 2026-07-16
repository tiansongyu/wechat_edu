const api = require("../../utils/api");
const locationPermission = require("../../utils/location-permission");
const DEFAULT_REGION = ["广东省", "深圳市", "南山区"];

const EMPTY_FORM = {
  title: "",
  province: "",
  city: "",
  district: "",
  area: "",
  grade: "",
  subject: "",
  price: "",
  settlement: "课结",
  schedule: "",
  description: "",
  studentInfo: "",
  address: "",
  contact: "",
  latitude: "",
  longitude: ""
};

Page({
  data: {
    loading: true,
    error: "",
    submitting: false,
    editingId: "",
    editingVersion: 0,
    editingPublished: false,
    actionId: "",
    publishType: "need",
    form: { ...EMPTY_FORM },
    teachingModes: ["线下授课", "线上授课"],
    modeIndex: 0,
    isOnline: false,
    regionValue: DEFAULT_REGION,
    grades: ["小学", "初中", "高中", "大学", "兴趣课"],
    subjects: ["数学", "英语", "语文", "物理", "化学", "全科", "编程", "其他"],
    settlements: ["课结", "日结", "周结", "月结"],
    gradeIndex: -1,
    subjectIndex: -1,
    settlementIndex: 0,
    posts: [],
    activeRole: "PARENT",
    roleName: "家长版"
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
      const account = await getApp().ensureAuth();
      const activeRole = account.activeRole || api.getActiveRole();
      const expectedType = activeRole === "TEACHER" ? "TEACHER_OFFER" : "TEACHING_NEED";
      const posts = (await api.getMineJobs()).filter((item) => item.type === expectedType);
      const editingStillVisible = posts.some((item) => item.id === this.data.editingId);
      this.setData({
        activeRole,
        roleName: activeRole === "TEACHER" ? "老师版" : "家长版",
        publishType: activeRole === "TEACHER" ? "offer" : "need",
        posts: posts.map(api.normalizeJob),
        ...(editingStillVisible || !this.data.editingId ? {} : {
          editingId: "",
          editingVersion: 0,
          editingPublished: false,
          form: { ...EMPTY_FORM },
          modeIndex: 0,
          isOnline: false,
          regionValue: DEFAULT_REGION,
          gradeIndex: -1,
          subjectIndex: -1,
          settlementIndex: 0
        }),
        loading: false,
        error: ""
      });
    } catch (error) {
      this.setData({ loading: false, error: error.message || "发布数据加载失败", posts: [] });
    }
  },

  retry() { this.loadData(); },

  switchType(event) {
    const expected = this.data.activeRole === "TEACHER" ? "offer" : "need";
    if (event.currentTarget.dataset.type !== expected) {
      wx.showToast({ title: `请先在“我的”切换到${expected === "offer" ? "老师" : "家长"}版`, icon: "none" });
    }
  },

  handleInput(event) {
    this.setData({ [`form.${event.currentTarget.dataset.field}`]: event.detail.value });
  },

  handlePicker(event) {
    const field = event.currentTarget.dataset.field;
    const index = Number(event.detail.value);
    const range = this.data[`${field}s`];
    const value = range[index];
    this.setData({ [`${field}Index`]: index, [`form.${field}`]: value });
  },

  handleModePicker(event) {
    const modeIndex = Number(event.detail.value);
    const isOnline = modeIndex === 1;
    const region = this.data.regionValue || DEFAULT_REGION;
    this.setData({
      modeIndex,
      isOnline,
      "form.province": isOnline ? "" : region[0],
      "form.city": isOnline ? "" : region[1],
      "form.district": isOnline ? "线上" : region[2],
      "form.area": "",
      "form.address": "",
      "form.latitude": "",
      "form.longitude": ""
    });
  },

  handleRegionPicker(event) {
    const regionValue = event.detail.value || DEFAULT_REGION;
    this.setData({
      regionValue,
      "form.province": regionValue[0],
      "form.city": regionValue[1],
      "form.district": regionValue[2],
      "form.area": "",
      "form.address": "",
      "form.latitude": "",
      "form.longitude": ""
    });
  },

  chooseLocation() {
    if (this.data.isOnline) {
      wx.showToast({ title: "线上授课不需要选择地点", icon: "none" });
      return;
    }
    if (!this.data.form.district) {
      wx.showToast({ title: "请先选择省市区", icon: "none" });
      return;
    }
    wx.chooseLocation({
      success: ({ address, name, latitude, longitude }) => {
        this.setData({
          "form.area": name || "",
          "form.address": address || name || "",
          "form.latitude": latitude,
          "form.longitude": longitude
        });
      },
      fail: (error) => {
        locationPermission.handleChooseLocationFailure(error, () => this.chooseLocation());
      }
    });
  },

  validate() {
    const form = this.data.form;
    const required = ["title", "district", "grade", "subject", "price", "schedule", "description", "contact"];
    if (required.some((field) => !String(form[field] || "").trim())) return "请把必填信息补充完整";
    const price = Number(form.price);
    if (!Number.isFinite(price) || price <= 0 || price > 1000000) return "请输入有效的课酬";
    if (!/^1[3-9]\d{9}$/.test(form.contact) && !/^[a-zA-Z][-_a-zA-Z0-9]{5,19}$/.test(form.contact)) return "请填写有效手机号或微信号";
    if (form.district !== "线上" && (!form.province || !form.city)) return "请选择完整省市区";
    if (form.district !== "线上" && (!form.address || !form.latitude || !form.longitude)) return "请通过地图搜索并选择真实授课地点";
    return "";
  },

  submitForm() {
    const validationError = this.validate();
    if (validationError) {
      wx.showToast({ title: validationError, icon: "none" });
      return;
    }
    wx.showModal({
      title: "确认发布",
      content: "提交后信息进入平台审核，审核结果以数据库状态为准。",
      confirmText: "提交审核",
      confirmColor: "#3478f6",
      success: async ({ confirm }) => {
        if (!confirm || this.data.submitting) return;
        this.setData({ submitting: true });
        try {
          const result = this.data.editingId
            ? await api.updateJob(this.data.editingId, this.data.form, this.data.editingVersion)
            : await api.createJob(this.data.form, this.data.publishType);
          this.setData({
            form: { ...EMPTY_FORM },
            editingId: "",
            editingVersion: 0,
            editingPublished: false,
            modeIndex: 0,
            isOnline: false,
            regionValue: DEFAULT_REGION,
            gradeIndex: -1,
            subjectIndex: -1,
            settlementIndex: 0
          });
          await this.loadData(false);
          wx.showToast({ title: result && result.revisionPending ? "修改申请已提交" : "已提交审核", icon: "success" });
        } catch (error) {
          wx.showToast({ title: error.message || "提交失败", icon: "none" });
        } finally {
          this.setData({ submitting: false });
        }
      }
    });
  },

  editPost(event) {
    const post = this.data.posts.find((item) => item.id === event.currentTarget.dataset.id);
    if (!post || !["DRAFT", "PENDING", "REJECTED", "PUBLISHED"].includes(post.status) || post.pendingRevision) return;
    const isOnline = post.district === "线上";
    const regionValue = isOnline
      ? DEFAULT_REGION
      : [post.province || "广东省", post.city || "深圳市", post.district || "南山区"];
    const gradeIndex = this.data.grades.indexOf(post.grade);
    const subjectIndex = this.data.subjects.indexOf(post.subject);
    const settlementIndex = this.data.settlements.indexOf(post.settlement);
    this.setData({
      editingId: post.id,
      editingVersion: post.version,
      editingPublished: post.status === "PUBLISHED",
      form: {
        title: post.title || "",
        province: post.province || "",
        city: post.city || "",
        district: post.district || "",
        area: post.area || "",
        grade: post.grade || "",
        subject: post.subject || "",
        price: post.price || "",
        settlement: post.settlement || "课结",
        schedule: post.schedule || "",
        description: post.description || "",
        studentInfo: post.studentInfo || "",
        address: post.address || "",
        contact: "",
        latitude: post.latitude === null || post.latitude === undefined ? "" : post.latitude,
        longitude: post.longitude === null || post.longitude === undefined ? "" : post.longitude
      },
      modeIndex: isOnline ? 1 : 0,
      isOnline,
      regionValue,
      gradeIndex,
      subjectIndex,
      settlementIndex: settlementIndex < 0 ? 0 : settlementIndex
    });
    wx.pageScrollTo({ scrollTop: 0, duration: 250 });
    wx.showToast({ title: "请重新填写联系方式后提交", icon: "none" });
  },

  cancelEdit() {
    this.setData({
      editingId: "",
      editingVersion: 0,
      editingPublished: false,
      form: { ...EMPTY_FORM },
      modeIndex: 0,
      isOnline: false,
      regionValue: DEFAULT_REGION,
      gradeIndex: -1,
      subjectIndex: -1,
      settlementIndex: 0
    });
  },

  togglePostStatus(event) {
    const id = event.currentTarget.dataset.id;
    const post = this.data.posts.find((item) => item.id === id);
    if (!post || this.data.actionId) return;
    const reopening = post.status === "CLOSED";
    wx.showModal({
      title: reopening ? "重新提交" : "关闭发布",
      content: reopening ? "重新提交后将再次进入平台审核。" : "关闭后该信息不会继续展示或接受新报名。",
      confirmText: reopening ? "重新提交" : "确认关闭",
      confirmColor: reopening ? "#3478f6" : "#d85858",
      success: async ({ confirm }) => {
        if (!confirm) return;
        this.setData({ actionId: id });
        try {
          if (reopening) await api.reopenJob(id);
          else await api.closeJob(id);
          await this.loadData(false);
          wx.showToast({ title: reopening ? "已重新提交" : "已关闭", icon: "none" });
        } catch (error) {
          wx.showToast({ title: error.message || "操作失败", icon: "none" });
        } finally {
          this.setData({ actionId: "" });
        }
      }
    });
  },

  manageApplications(event) {
    const id = event.currentTarget.dataset.id;
    const post = this.data.posts.find((item) => item.id === id);
    if (post) wx.navigateTo({ url: `/pages/job-applications/job-applications?jobId=${id}&title=${encodeURIComponent(post.title)}` });
  }
});
