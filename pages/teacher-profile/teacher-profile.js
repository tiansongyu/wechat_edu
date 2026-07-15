const api = require("../../utils/api");

Page({
  data: {
    loading: true,
    error: "",
    saving: false,
    profile: null,
    auditStatusLabel: "尚未提交审核",
    auditStatusTone: "UNSUBMITTED",
    form: { realName: "", school: "", major: "", education: "", teachingYears: "0", hourlyRate: "", subjects: "", serviceDistricts: "", bio: "" },
    certifications: []
  },

  onLoad() { this.loadProfile(); },

  async loadProfile() {
    this.setData({ loading: true, error: "" });
    try {
      await getApp().ensureAuth();
      const profile = await api.getTeacherProfile();
      const submitted = Boolean(profile.submittedAt);
      this.setData({
        profile,
        auditStatusLabel: !submitted
          ? "尚未提交审核"
          : ({ APPROVED: "认证已通过", REJECTED: "请修改后重提", PENDING: "等待平台审核" }[profile.auditStatus] || "等待平台审核"),
        auditStatusTone: submitted ? profile.auditStatus : "UNSUBMITTED",
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
      this.setData({ error: error.message || "资料加载失败", profile: null });
    } finally {
      this.setData({ loading: false });
    }
  },

  retry() { this.loadProfile(); },
  handleInput(event) { this.setData({ [`form.${event.currentTarget.dataset.field}`]: event.detail.value }); },
  splitList(value) { return String(value || "").split(/[、,，\s]+/).map((item) => item.trim()).filter(Boolean); },

  async saveProfile() {
    const { form, profile } = this.data;
    if (!profile || !form.realName.trim() || !form.school.trim() || !form.major.trim() || !form.education.trim() || !form.subjects.trim()) {
      wx.showToast({ title: "请补全姓名、学校、专业、学历和科目", icon: "none" });
      return;
    }
    const teachingYears = Number(form.teachingYears || 0);
    const hourlyRate = form.hourlyRate ? Number(form.hourlyRate) : 0;
    if (!Number.isInteger(teachingYears) || teachingYears < 0 || teachingYears > 60 || !Number.isFinite(hourlyRate) || hourlyRate < 0) {
      wx.showToast({ title: "请填写有效的教学年限和参考课酬", icon: "none" });
      return;
    }
    this.setData({ saving: true });
    try {
      await api.updateTeacherProfile({
        realName: form.realName.trim(),
        school: form.school.trim(),
        major: form.major.trim(),
        education: form.education.trim(),
        teachingYears,
        hourlyRateCents: form.hourlyRate ? Math.round(hourlyRate * 100) : undefined,
        subjects: this.splitList(form.subjects),
        serviceDistricts: this.splitList(form.serviceDistricts),
        bio: form.bio.trim(),
        version: profile.version
      });
      getApp().globalData.account = null;
      getApp().globalData.authReady = null;
      await this.loadProfile();
      wx.showToast({ title: "已提交认证审核", icon: "success" });
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
      extension: ["jpg", "jpeg", "png", "pdf"],
      success: ({ tempFiles }) => this.uploadCertification(tempFiles[0]),
      fail: (error) => {
        if (error && /cancel/i.test(error.errMsg || "")) return;
        wx.showToast({ title: "未能选择认证材料", icon: "none" });
      }
    });
  },

  async uploadCertification(file) {
    if (!file || !file.path) return;
    const extension = String(file.name || "").split(".").pop().toLowerCase();
    const contentType = extension === "pdf" ? "application/pdf" : extension === "png" ? "image/png" : "image/jpeg";
    wx.showLoading({ title: "上传中" });
    try {
      const signed = await api.createUploadUrl({ fileName: file.name, contentType, size: file.size });
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
          fail: () => reject(new Error("文件服务连接失败"))
        });
      });
      await api.addTeacherCertification({ type: extension === "pdf" ? "学历或资格证明" : "认证图片", objectKey: signed.objectKey });
      getApp().globalData.account = null;
      getApp().globalData.authReady = null;
      await this.loadProfile();
      wx.showToast({ title: "材料已上传", icon: "success" });
    } catch (error) {
      wx.showToast({ title: error.message || "上传失败", icon: "none" });
    } finally {
      wx.hideLoading();
    }
  }
});
