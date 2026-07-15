const api = require("../../utils/api");

Page({
  data: {
    loading: true,
    saving: false,
    profile: null,
    form: {
      realName: "",
      school: "",
      major: "",
      education: "",
      teachingYears: "0",
      hourlyRate: "",
      subjects: "",
      serviceDistricts: "",
      bio: ""
    },
    certifications: []
  },

  onLoad() {
    this.loadProfile();
  },

  async loadProfile() {
    try {
      if (getApp().globalData.authReady) await getApp().globalData.authReady;
      const profile = await api.request("/api/v1/profiles/teacher");
      this.setData({
        profile,
        certifications: profile.certifications || [],
        form: {
          realName: profile.realName || "",
          school: profile.school || "",
          major: profile.major || "",
          education: profile.education || "",
          teachingYears: String(profile.teachingYears || 0),
          hourlyRate: profile.hourlyRateCents ? String(profile.hourlyRateCents / 100) : "",
          subjects: (profile.subjects || []).join("、"),
          serviceDistricts: (profile.serviceDistricts || []).join("、"),
          bio: profile.bio || ""
        }
      });
    } catch (error) {
      wx.showToast({ title: error.message || "资料加载失败", icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },

  handleInput(event) {
    this.setData({ [`form.${event.currentTarget.dataset.field}`]: event.detail.value });
  },

  splitList(value) {
    return String(value || "").split(/[、,，\s]+/).map((item) => item.trim()).filter(Boolean);
  },

  async saveProfile() {
    const { form, profile } = this.data;
    if (!profile || !form.realName || !form.school || !form.major || !form.education || !form.subjects) {
      wx.showToast({ title: "请补全姓名、学校、专业、学历和科目", icon: "none" });
      return;
    }
    this.setData({ saving: true });
    try {
      await api.request("/api/v1/profiles/teacher", {
        method: "PATCH",
        data: {
          realName: form.realName,
          school: form.school,
          major: form.major,
          education: form.education,
          teachingYears: Number(form.teachingYears || 0),
          hourlyRateCents: form.hourlyRate ? Math.round(Number(form.hourlyRate) * 100) : undefined,
          subjects: this.splitList(form.subjects),
          serviceDistricts: this.splitList(form.serviceDistricts),
          bio: form.bio,
          version: profile.version
        }
      });
      wx.showToast({ title: "已提交认证审核", icon: "success" });
      await this.loadProfile();
    } catch (error) {
      wx.showToast({ title: error.message || "保存失败", icon: "none" });
    } finally {
      this.setData({ saving: false });
    }
  },

  chooseCertification() {
    wx.chooseMessageFile({
      count: 1,
      type: "file",
      extension: ["jpg", "jpeg", "png", "webp", "pdf"],
      success: ({ tempFiles }) => this.uploadCertification(tempFiles[0])
    });
  },

  async uploadCertification(file) {
    const extension = String(file.name || "").split(".").pop().toLowerCase();
    const contentType = extension === "pdf" ? "application/pdf" : extension === "png" ? "image/png" : extension === "webp" ? "image/webp" : "image/jpeg";
    wx.showLoading({ title: "上传中" });
    try {
      const signed = await api.request("/api/v1/files/upload-url", {
        method: "POST",
        data: { fileName: file.name, contentType, size: file.size }
      });
      const binary = await new Promise((resolve, reject) => {
        wx.getFileSystemManager().readFile({ filePath: file.path, success: ({ data }) => resolve(data), fail: reject });
      });
      await new Promise((resolve, reject) => {
        wx.request({
          url: signed.uploadUrl,
          method: "PUT",
          data: binary,
          header: { "content-type": contentType },
          success: ({ statusCode }) => statusCode >= 200 && statusCode < 300 ? resolve() : reject(new Error("文件上传失败")),
          fail: reject
        });
      });
      await api.request("/api/v1/profiles/teacher/certifications", {
        method: "POST",
        data: { type: extension === "pdf" ? "学历或资格证明" : "认证图片", fileUrl: signed.uploadUrl.split("?")[0] }
      });
      wx.showToast({ title: "材料已上传", icon: "success" });
      await this.loadProfile();
    } catch (error) {
      wx.showToast({ title: error.message || "上传失败", icon: "none" });
    } finally {
      wx.hideLoading();
    }
  }
});
