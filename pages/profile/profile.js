const api = require("../../utils/api");
const locationPermission = require("../../utils/location-permission");
const DEFAULT_REGION = ["广东省", "深圳市", "南山区"];
const AVATAR_CACHE_KEY = "tutor_link_avatar_cache_v1";

const APPLICATION_STATUS = { PENDING: "待处理", ACCEPTED: "已录用", REJECTED: "未选中", CANCELLED: "已取消" };
const APPOINTMENT_STATUS = { PENDING: "待确认", CONFIRMED: "已确认", COMPLETED: "已完成", CANCELLED: "已取消", DISPUTED: "有争议" };

function unwrapPayload(response) {
  let payload = response;
  for (let depth = 0; depth < 2; depth += 1) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload) || payload.data === undefined) break;
    payload = payload.data;
  }
  return payload;
}

function normalizeCollection(response, label) {
  const payload = unwrapPayload(response);
  if (Array.isArray(payload)) return payload.filter((item) => item && typeof item === "object");
  if (payload && typeof payload === "object") {
    for (const key of ["items", "list", "results"]) {
      if (Array.isArray(payload[key])) {
        return payload[key].filter((item) => item && typeof item === "object");
      }
    }
  }
  throw new Error(`${label}数据格式异常`);
}

function normalizeObject(response, label) {
  const payload = unwrapPayload(response);
  if (payload && typeof payload === "object" && !Array.isArray(payload)) return payload;
  throw new Error(`${label}数据格式异常`);
}

function settleCollection(promise, label) {
  return Promise.resolve(promise)
    .then((response) => ({ value: normalizeCollection(response, label), error: null, label }))
    .catch((error) => ({ value: [], error, label }));
}

function settleObject(promise, label, fallback) {
  return Promise.resolve(promise)
    .then((response) => ({ value: normalizeObject(response, label), error: null, label }))
    .catch((error) => ({ value: fallback, error, label }));
}

function settleReviews(promise) {
  const fallback = {
    unavailable: true,
    items: [],
    summary: { displayAverage: null, count: 0, levelLabel: "评价积累中" }
  };
  return Promise.resolve(promise)
    .then((response) => {
      const payload = normalizeObject(response, "合作评价");
      if (!Array.isArray(payload.items) || !payload.summary || typeof payload.summary !== "object" || Array.isArray(payload.summary)) {
        throw new Error("合作评价数据格式异常");
      }
      return { value: payload, error: null, label: "合作评价" };
    })
    .catch((error) => ({ value: fallback, error, label: "合作评价" }));
}

function avatarContentType(data, fallback = "") {
  if (!data || typeof data.byteLength !== "number") return fallback;
  const bytes = new Uint8Array(data);
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  return fallback;
}

function avatarCachePath(accountId, contentType) {
  const safeId = String(accountId || "account").replace(/[^a-z0-9_-]/gi, "").slice(0, 64) || "account";
  const extension = contentType === "image/png" ? "png" : "jpg";
  return `${wx.env.USER_DATA_PATH}/tutor-avatar-${safeId}.${extension}`;
}

function cachedAvatarPath(account) {
  if (!account || !account.id || !account.avatarUrl) return "";
  const cached = wx.getStorageSync(AVATAR_CACHE_KEY);
  if (!cached || cached.accountId !== account.id || cached.remoteUrl !== account.avatarUrl || !cached.filePath) return "";
  try {
    const manager = wx.getFileSystemManager();
    if (typeof manager.accessSync === "function") manager.accessSync(cached.filePath);
    return cached.filePath;
  } catch {
    wx.removeStorageSync(AVATAR_CACHE_KEY);
    return "";
  }
}

function cacheAvatarBytes(account, data, contentType) {
  return new Promise((resolve, reject) => {
    if (!account || !account.id || !account.avatarUrl) {
      reject(new Error("头像账号信息不完整"));
      return;
    }
    const detectedType = avatarContentType(data, contentType);
    if (!["image/jpeg", "image/png"].includes(detectedType)) {
      reject(new Error("头像文件格式异常"));
      return;
    }
    const filePath = avatarCachePath(account.id, detectedType);
    wx.getFileSystemManager().writeFile({
      filePath,
      data,
      success() {
        wx.setStorageSync(AVATAR_CACHE_KEY, { accountId: account.id, remoteUrl: account.avatarUrl, filePath });
        resolve(filePath);
      },
      fail: reject
    });
  });
}

Page({
  data: {
    loading: true,
    error: "",
    warning: "",
    actionId: "",
    rolePromptOpen: false,
    account: null,
    accountInitial: "人",
    avatarDisplayUrl: "",
    showNicknameEditor: false,
    nicknameDraft: "",
    savingNickname: false,
    avatarUploading: false,
    activeRole: "PARENT",
    roleName: "家长版",
    profileMeta: "资料未完善",
    identityHint: "完善身份与匹配资料",
    metricTitle: "资料状态",
    metricValue: "未完善",
    metricHint: "完善资料后可获得更准确的匹配",
    receivedReviewSummary: { displayAverage: null, count: 0, levelLabel: "评价积累中" },
    reviewSummaryUnavailable: false,
    auditNote: "",
    activePanel: "applications",
    applications: [],
    favorites: [],
    posts: [],
    appointments: [],
    visibleItems: [],
    panelTitle: "报名动态",
    showSettings: false,
    settings: { jobNotice: true, chatNotice: true, privacyMode: true },
    showParentEditor: false,
    parentRegion: DEFAULT_REGION,
    parentForm: {
      province: "", city: "", district: "", address: "", latitude: "", longitude: "",
      studentNickname: "", studentGender: "", studentGrade: "", schoolName: "",
      currentLevel: "", targetGoal: "", weakSubjects: "", learningGoals: "",
      learningStyle: "", personalityNotes: "", preferredSchedule: "", tutorExpectations: ""
    },
    savingParent: false
  },

  onShow() {
    this.loadData();
  },

  async onPullDownRefresh() {
    await this.loadData(false);
    wx.stopPullDownRefresh();
  },

  async loadData(showLoading = true) {
    this.setData({ ...(showLoading ? { loading: true } : {}), error: "", warning: "" });
    try {
      await getApp().ensureAuth();
      const account = await api.getAccount();
      const activeRole = account.activeRole || api.getActiveRole();
      const roleApplications = activeRole === "TEACHER" ? api.listTeacherApplications() : api.listAllParentApplications();
      const [postsResult, favoritesResult, applicationsResult, preferencesResult, appointmentsResult, reviewsResult] = await Promise.all([
        settleCollection(api.getMineJobs(), "我的发布"),
        settleCollection(api.listFavoriteJobs(), "我的收藏"),
        settleCollection(roleApplications, "报名动态"),
        settleObject(api.getPreferences(), "偏好设置", this.data.settings),
        settleCollection(api.listAppointments(), "预约记录"),
        settleReviews(api.listMyReceivedReviews({ limit: 3 }))
      ]);
      const warningLabels = [postsResult, favoritesResult, applicationsResult, preferencesResult, appointmentsResult, reviewsResult]
        .filter((result) => result.error)
        .map((result) => result.label);
      const warning = warningLabels.length
        ? `部分数据暂未同步：${warningLabels.join("、")}。其他功能仍可正常使用。`
        : "";
      const rawPosts = postsResult.value;
      const rawFavorites = favoritesResult.value;
      const rawApplications = applicationsResult.value;
      const preferences = preferencesResult.value;
      const rawAppointments = appointmentsResult.value;
      const receivedReviews = reviewsResult.value;
      const expectedPostType = activeRole === "TEACHER" ? "TEACHER_OFFER" : "TEACHING_NEED";
      const posts = rawPosts
        .filter((item) => item.type === expectedPostType)
        .map((item) => ({ ...api.normalizeJob(item), recordType: "post" }));
      const favorites = rawFavorites.map((item) => ({ ...api.normalizeJob(item), recordType: "favorite" }));
      const applications = rawApplications.map((item) => this.normalizeApplication(item, activeRole));
      const appointments = rawAppointments
        .filter((item) => activeRole === "TEACHER"
          ? item.application && item.application.teacherId === account.id
          : item.job && item.job.ownerId === account.id)
        .map((item) => this.normalizeAppointment(item, account.id, activeRole));
      const parentProfile = account.parentProfile || {};
      const teacherProfile = account.teacherProfile || {};
      const profileMeta = activeRole === "TEACHER"
        ? [teacherProfile.school, teacherProfile.major].filter(Boolean).join(" · ") || "教师资料未完善"
        : [parentProfile.city, parentProfile.district].filter(Boolean).join(" · ") || "常用区域未完善";
      const identityHint = activeRole === "TEACHER"
        ? !teacherProfile.submittedAt
          ? "教师认证尚未提交"
          : teacherProfile.auditStatus === "APPROVED"
            ? "教师认证已通过"
            : teacherProfile.auditStatus === "PENDING"
              ? "教师认证正在审核"
              : `认证需修改：${teacherProfile.auditNote || "请查看审核意见"}`
        : [parentProfile.city, parentProfile.district, parentProfile.address].filter(Boolean).length === 3
          ? "家长常用区域与地址已完善"
          : "完善常用区域可获得更准确的匹配";
      const receivedReviewSummary = receivedReviews.summary || { displayAverage: null, count: 0, levelLabel: "评价积累中" };
      const reviewSummaryUnavailable = Boolean(receivedReviews.unavailable);
      const metricTitle = activeRole === "TEACHER" ? "我的教师口碑" : "我的家长口碑";
      const metricValue = reviewSummaryUnavailable
        ? "暂不可用"
        : receivedReviewSummary.displayAverage !== null
          ? `${receivedReviewSummary.displayAverage} ★`
          : receivedReviewSummary.count
            ? `${receivedReviewSummary.count} 条`
            : "待积累";
      const metricHint = reviewSummaryUnavailable
        ? "口碑加载失败 · 点击进入重试查看"
        : `${receivedReviewSummary.levelLabel || "评价积累中"} · 查看 ${receivedReviewSummary.count || 0} 条真实合作评价`;
      this.setData({
        account,
        accountInitial: account.nickname ? account.nickname.slice(0, 1) : "人",
        avatarDisplayUrl: cachedAvatarPath(account) || account.avatarUrl || "",
        nicknameDraft: account.nickname || "",
        activeRole,
        roleName: activeRole === "TEACHER" ? "老师版" : "家长版",
        profileMeta,
        identityHint,
        metricTitle,
        metricValue,
        metricHint,
        receivedReviewSummary,
        reviewSummaryUnavailable,
        auditNote: teacherProfile.auditNote || "",
        applications,
        favorites,
        posts,
        appointments,
        warning,
        settings: { ...this.data.settings, ...(preferences || {}) },
        parentRegion: [parentProfile.province || "广东省", parentProfile.city || "深圳市", parentProfile.district || "南山区"],
        parentForm: {
          province: parentProfile.province || "",
          city: parentProfile.city || "",
          district: parentProfile.district || "",
          address: parentProfile.address || "",
          latitude: parentProfile.latitude === null || parentProfile.latitude === undefined ? "" : parentProfile.latitude,
          longitude: parentProfile.longitude === null || parentProfile.longitude === undefined ? "" : parentProfile.longitude
          ,studentNickname: parentProfile.studentNickname || "",
          studentGender: parentProfile.studentGender || "",
          studentGrade: parentProfile.studentGrade || "",
          schoolName: parentProfile.schoolName || "",
          currentLevel: parentProfile.currentLevel || "",
          targetGoal: parentProfile.targetGoal || "",
          weakSubjects: (parentProfile.weakSubjects || []).join("、"),
          learningGoals: (parentProfile.learningGoals || []).join("、"),
          learningStyle: parentProfile.learningStyle || "",
          personalityNotes: parentProfile.personalityNotes || "",
          preferredSchedule: (parentProfile.preferredSchedule || []).join("、"),
          tutorExpectations: parentProfile.tutorExpectations || ""
        },
        loading: false,
        error: ""
      }, () => {
        this.applyPanel();
        this.refreshAvatarCache(account);
      });
      getApp().globalData.account = account;
      getApp().globalData.activeRole = activeRole;
      return true;
    } catch (error) {
      this.setData({ loading: false, error: error.message || "个人中心加载失败", warning: "", visibleItems: [] });
      return false;
    }
  },

  normalizeApplication(item, role) {
    const job = api.normalizeJob(item.job || {});
    const teacher = item.teacher || {};
    return {
      id: item.id,
      jobId: item.jobId || job.id,
      title: role === "TEACHER" ? (job.title || "已删除的家教需求") : `${teacher.nickname || "老师"}申请：${job.title || "家教需求"}`,
      meta: role === "TEACHER" ? `${job.locationLabel || "地点待沟通"} · ¥${job.price || "--"}${job.unit || ""}` : [teacher.teacherProfile && teacher.teacherProfile.school, teacher.teacherProfile && teacher.teacherProfile.major].filter(Boolean).join(" · ") || "教师资料未完善",
      status: item.status,
      statusLabel: APPLICATION_STATUS[item.status] || item.status,
      statusNote: item.statusNote || item.note || "",
      conversationId: item.conversationId || (item.conversation && item.conversation.id) || "",
      recordType: "application"
    };
  },

  normalizeAppointment(item, accountId, activeRole) {
    const job = api.normalizeJob(item.job || (item.application && item.application.job) || {});
    const ownerId = item.job && item.job.ownerId;
    const teacherId = item.application && item.application.teacherId;
    const completionActions = item.completionActions || {};
    const completionProgress = item.completionProgress || {};
    let statusLabel = APPOINTMENT_STATUS[item.status] || item.status;
    let workflowHint = item.statusNote || "";
    if (item.status === "CONFIRMED") {
      if (completionActions.canAcknowledge) {
        statusLabel = "待我确认完成";
        workflowHint = "确认本次服务已完成后，还需等待合作方确认";
      } else if (completionActions.waitingForOtherParty) {
        statusLabel = "等待对方确认";
        workflowHint = "我已确认完成，正在等待合作方确认";
      } else if (completionActions.requiresRoleSwitch) {
        statusLabel = "切换身份确认";
        workflowHint = `请切换到${completionActions.requiredRole === "TEACHER" ? "老师" : "家长"}版确认完成`;
      }
    } else if (item.status === "COMPLETED") {
      if (item.canReview) {
        statusLabel = "待评价";
        workflowHint = `双方已确认完成，可以评价${item.reviewTarget ? item.reviewTarget.label : "合作方"}`;
      } else if (item.myReview) {
        statusLabel = "已评价";
        workflowHint = `已提交 ${item.myReview.rating} 星评价`;
      } else if (completionProgress.fullyAcknowledged) {
        workflowHint = "双方均已确认本次合作完成";
      }
    }
    return {
      ...item,
      jobId: item.jobId || job.id,
      title: job.title || "合作预约",
      meta: [job.locationLabel, item.startAt ? api.formatDate(item.startAt) : "时间待确认"].filter(Boolean).join(" · "),
      statusLabel,
      workflowHint,
      canConfirm: activeRole === "TEACHER" && item.status === "PENDING" && teacherId === accountId,
      canComplete: Boolean(completionActions.canAcknowledge),
      hasAcknowledged: Boolean(completionActions.hasAcknowledged),
      waitingForOtherParty: Boolean(completionActions.waitingForOtherParty),
      requiresRoleSwitch: Boolean(completionActions.requiresRoleSwitch),
      canReview: Boolean(item.canReview),
      myReview: item.myReview || null,
      reviewTarget: item.reviewTarget || null,
      canCancel: (item.status === "PENDING" || item.status === "CONFIRMED") && (ownerId === accountId || teacherId === accountId),
      canDispute: ["PENDING", "CONFIRMED", "COMPLETED"].includes(item.status) && (ownerId === accountId || teacherId === accountId),
      recordType: "appointment"
    };
  },

  retry() { this.loadData(); },

  editNickname() {
    if (!this.data.account || this.data.savingNickname) return;
    this.setData({
      showNicknameEditor: true,
      nicknameDraft: this.data.account.nickname || ""
    });
  },

  closeNicknameEditor() {
    if (this.data.savingNickname) return;
    this.setData({ showNicknameEditor: false });
  },

  preventNicknameClose() {},

  handleNicknameInput(event) {
    this.setData({ nicknameDraft: event.detail.value });
  },

  async saveNickname() {
    if (this.data.savingNickname) return;
    const nickname = String(this.data.nicknameDraft || "").trim().replace(/\s+/g, " ");
    if (!nickname) {
      wx.showToast({ title: "请输入昵称", icon: "none" });
      return;
    }
    if (nickname.length > 30) {
      wx.showToast({ title: "昵称最多30个字符", icon: "none" });
      return;
    }
    if (nickname === this.data.account.nickname) {
      this.setData({ showNicknameEditor: false, nicknameDraft: nickname });
      wx.showToast({ title: "昵称未发生变化", icon: "none" });
      return;
    }

    this.setData({ savingNickname: true });
    try {
      const account = await api.updateAccount({ nickname });
      this.setData({
        account,
        accountInitial: account.nickname ? account.nickname.slice(0, 1) : "人",
        nicknameDraft: account.nickname || "",
        showNicknameEditor: false
      });
      getApp().globalData.account = account;
      wx.showToast({ title: "昵称已保存", icon: "success" });
    } catch (error) {
      wx.showToast({ title: error.message || "昵称保存失败", icon: "none" });
    } finally {
      this.setData({ savingNickname: false });
    }
  },

  async chooseAvatar(event) {
    const filePath = event.detail && event.detail.avatarUrl;
    if (!filePath || this.data.avatarUploading) return;
    const previousDisplayUrl = this.data.avatarDisplayUrl;
    this.setData({ avatarUploading: true, avatarDisplayUrl: filePath });
    wx.showLoading({ title: "上传头像" });
    try {
      const fileInfo = await new Promise((resolve, reject) => {
        wx.getFileSystemManager().getFileInfo({ filePath, success: resolve, fail: reject });
      });
      const binary = await new Promise((resolve, reject) => {
        wx.getFileSystemManager().readFile({ filePath, success: ({ data }) => resolve(data), fail: reject });
      });
      const lowerPath = String(filePath).toLowerCase();
      const contentType = avatarContentType(binary, lowerPath.includes(".png") ? "image/png" : "image/jpeg");
      const extension = contentType === "image/png" ? "png" : "jpg";
      const signed = await api.createUploadUrl({
        purpose: "AVATAR",
        fileName: `wechat-avatar.${extension}`,
        contentType,
        size: fileInfo.size
      });
      await new Promise((resolve, reject) => {
        const uploadHeaders = {
          ...(signed.requiredHeaders || { "Content-Type": contentType }),
          ...(String(signed.uploadUrl || "").includes(".ngrok-free.") ? { "ngrok-skip-browser-warning": "true" } : {})
        };
        wx.request({
          url: signed.uploadUrl,
          method: "PUT",
          data: binary,
          header: uploadHeaders,
          success: ({ statusCode }) => statusCode >= 200 && statusCode < 300 ? resolve() : reject(new Error("头像上传失败")),
          fail: () => reject(new Error("文件服务连接失败"))
        });
      });
      const account = await api.updateAccount({ avatarObjectKey: signed.objectKey });
      let avatarDisplayUrl = filePath;
      try {
        avatarDisplayUrl = await cacheAvatarBytes(account, binary, contentType);
      } catch {}
      this.setData({ account, accountInitial: account.nickname ? account.nickname.slice(0, 1) : "人", avatarDisplayUrl });
      getApp().globalData.account = account;
      wx.hideLoading();
      wx.showToast({ title: "头像已更新", icon: "success" });
    } catch (error) {
      this.setData({ avatarDisplayUrl: previousDisplayUrl });
      wx.hideLoading();
      wx.showToast({ title: error.message || "头像更新失败", icon: "none" });
    } finally {
      this.setData({ avatarUploading: false });
    }
  },

  async refreshAvatarCache(account, force = false) {
    if (!account || !account.avatarUrl) return;
    const cached = cachedAvatarPath(account);
    if (cached && !force) {
      if (this.data.avatarDisplayUrl !== cached) this.setData({ avatarDisplayUrl: cached });
      return;
    }
    if (this._avatarCacheRequest === account.avatarUrl) return;
    this._avatarCacheRequest = account.avatarUrl;
    try {
      const binary = await api.fetchMedia(account.avatarUrl);
      const filePath = await cacheAvatarBytes(account, binary, "");
      if (this.data.account && this.data.account.id === account.id && this.data.account.avatarUrl === account.avatarUrl) {
        this.setData({ avatarDisplayUrl: filePath });
      }
    } catch {
      if (this.data.avatarDisplayUrl === account.avatarUrl) this.setData({ avatarDisplayUrl: "" });
    } finally {
      this._avatarCacheRequest = "";
    }
  },

  handleAvatarError() {
    const account = this.data.account;
    this.setData({ avatarDisplayUrl: "" });
    if (account && account.avatarUrl) this.refreshAvatarCache(account, true);
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
        account: result.account || this.data.account,
        activePanel: "applications",
        showParentEditor: false,
        showSettings: false
      });
      const refreshed = await this.loadData(false);
      wx.showToast({
        title: refreshed
          ? `已进入${next === "TEACHER" ? "老师" : "家长"}版`
          : "身份已切换，个人资料暂未刷新",
        icon: "none"
      });
    } catch (error) {
      wx.showToast({ title: error.message || "身份切换失败", icon: "none" });
    } finally {
      this.setData({ actionId: "" });
    }
  },

  selectPanel(event) {
    this.setData({ activePanel: event.currentTarget.dataset.panel }, () => this.applyPanel());
  },

  applyPanel() {
    const panelMap = {
      applications: { title: this.data.activeRole === "TEACHER" ? "我的申请" : "收到的报名", items: this.data.applications },
      favorites: { title: "我的收藏", items: this.data.favorites },
      posts: { title: "我的发布", items: this.data.posts },
      appointments: { title: "合作预约", items: this.data.appointments }
    };
    const current = panelMap[this.data.activePanel] || panelMap.applications;
    this.setData({ panelTitle: current.title, visibleItems: current.items });
  },

  openItem(event) {
    const item = this.data.visibleItems.find((entry) => entry.id === event.currentTarget.dataset.id);
    if (!item) return;
    if (item.recordType === "application" && this.data.activeRole === "PARENT") {
      wx.navigateTo({ url: `/pages/job-applications/job-applications?jobId=${item.jobId}` });
      return;
    }
    if (item.jobId || item.id) wx.navigateTo({ url: `/pages/job-detail/job-detail?id=${item.jobId || item.id}` });
  },

  cancelApplication(event) {
    const id = event.currentTarget.dataset.id;
    wx.showModal({
      title: "取消申请",
      content: "取消后发布人将不再处理本次申请，请填写取消原因。",
      editable: true,
      placeholderText: "请输入取消原因（必填）",
      confirmText: "确认取消",
      confirmColor: "#d85858",
      success: async ({ confirm, content }) => {
        if (!confirm || this.data.actionId) return;
        const reason = String(content || "").trim();
        if (!reason) {
          wx.showToast({ title: "请输入取消原因", icon: "none" });
          return;
        }
        const commandSignature = `${id}:application-cancel:${reason}`;
        if (!this._pendingCommand || this._pendingCommand.signature !== commandSignature) {
          this._pendingCommand = {
            signature: commandSignature,
            key: api.createCommandKey("application-cancel", id)
          };
        }
        this.setData({ actionId: id });
        try {
          await api.cancelApplication(id, reason, this._pendingCommand.key);
          this._pendingCommand = null;
          await this.loadData(false);
          wx.showToast({ title: "申请已取消", icon: "none" });
        } catch (error) {
          wx.showToast({ title: error.message || "取消失败", icon: "none" });
        } finally {
          this.setData({ actionId: "" });
        }
      }
    });
  },

  improveProfile() {
    if (this.data.activeRole === "TEACHER") wx.navigateTo({ url: "/pages/teacher-profile/teacher-profile" });
    else this.setData({ showParentEditor: true, showSettings: false });
  },

  openReceivedReviews() {
    wx.navigateTo({ url: "/pages/reviews/reviews?received=1" });
  },

  goReview(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: `/pages/reviews/reviews?appointmentId=${id}` });
  },

  closeParentEditor() { this.setData({ showParentEditor: false }); },
  handleParentInput(event) {
    this.setData({ [`parentForm.${event.currentTarget.dataset.field}`]: event.detail.value });
  },
  splitProfileList(value) {
    return String(value || "").split(/[、,，\n]+/).map((item) => item.trim()).filter(Boolean);
  },
  handleParentRegion(event) {
    const parentRegion = event.detail.value || DEFAULT_REGION;
    this.setData({
      parentRegion,
      "parentForm.province": parentRegion[0],
      "parentForm.city": parentRegion[1],
      "parentForm.district": parentRegion[2],
      "parentForm.address": "",
      "parentForm.latitude": "",
      "parentForm.longitude": ""
    });
  },

  chooseParentLocation() {
    if (!this.data.parentForm.district) {
      wx.showToast({ title: "请先选择省市区", icon: "none" });
      return;
    }
    wx.chooseLocation({
      success: ({ address, name, latitude, longitude }) => {
        this.setData({
          "parentForm.address": [name, address].filter(Boolean).join(" · "),
          "parentForm.latitude": latitude,
          "parentForm.longitude": longitude
        });
      },
      fail: (error) => {
        locationPermission.handleChooseLocationFailure(error, () => this.chooseParentLocation());
      }
    });
  },

  async saveParentProfile() {
    const form = this.data.parentForm;
    if (!form.province.trim() || !form.city.trim() || !form.district.trim()) {
      wx.showToast({ title: "请选择完整省市区", icon: "none" });
      return;
    }
    this.setData({ savingParent: true });
    try {
      await api.updateParentProfile({
        province: form.province.trim(),
        city: form.city.trim(),
        district: form.district.trim(),
        address: form.address.trim() || undefined,
        latitude: form.latitude === "" ? undefined : Number(form.latitude),
        longitude: form.longitude === "" ? undefined : Number(form.longitude)
        ,studentNickname: form.studentNickname.trim() || undefined,
        studentGender: form.studentGender.trim() || undefined,
        studentGrade: form.studentGrade.trim() || undefined,
        schoolName: form.schoolName.trim() || undefined,
        currentLevel: form.currentLevel.trim() || undefined,
        targetGoal: form.targetGoal.trim() || undefined,
        weakSubjects: this.splitProfileList(form.weakSubjects),
        learningGoals: this.splitProfileList(form.learningGoals),
        learningStyle: form.learningStyle.trim() || undefined,
        personalityNotes: form.personalityNotes.trim() || undefined,
        preferredSchedule: this.splitProfileList(form.preferredSchedule),
        tutorExpectations: form.tutorExpectations.trim() || undefined
      });
      this.setData({ showParentEditor: false });
      await this.loadData(false);
      wx.showToast({ title: "资料已保存", icon: "success" });
    } catch (error) {
      wx.showToast({ title: error.message || "保存失败", icon: "none" });
    } finally {
      this.setData({ savingParent: false });
    }
  },

  toggleSettings() { this.setData({ showSettings: !this.data.showSettings, showParentEditor: false }); },

  async updateSetting(event) {
    const field = event.currentTarget.dataset.field;
    const value = event.detail.value;
    try {
      const preferences = await api.updatePreferences({ [field]: value });
      this.setData({ settings: { ...this.data.settings, ...(preferences || {}), [field]: value } });
    } catch (error) {
      this.setData({ settings: { ...this.data.settings } });
      wx.showToast({ title: error.message || "设置保存失败", icon: "none" });
    }
  },

  appointmentAction(event) {
    const id = event.currentTarget.dataset.id;
    const action = event.currentTarget.dataset.action;
    const labels = { confirm: "确认预约", complete: "确认完成", cancel: "取消预约", dispute: "发起争议" };
    const requiresReason = action === "cancel" || action === "dispute";
    wx.showModal({
      title: labels[action] || "更新预约",
      content: requiresReason
        ? `${action === "cancel" ? "取消" : "争议"}会同步给合作方，请填写原因。`
        : action === "complete"
          ? "请确认本次服务已经完成。提交后还需合作方确认，双方确认后才会进入已完成。"
          : "确认后，预约状态会同步给合作双方。",
      editable: requiresReason,
      placeholderText: requiresReason ? `请输入${action === "cancel" ? "取消" : "争议"}原因（必填）` : "",
      confirmText: "确认",
      confirmColor: requiresReason ? "#d85858" : "#3478f6",
      success: async ({ confirm, content }) => {
        if (!confirm || this.data.actionId) return;
        const reason = String(content || "").trim();
        if (requiresReason && !reason) {
          wx.showToast({ title: `请输入${action === "cancel" ? "取消" : "争议"}原因`, icon: "none" });
          return;
        }
        const commandSignature = `${id}:appointment-${action}:${reason}`;
        if (!this._pendingCommand || this._pendingCommand.signature !== commandSignature) {
          this._pendingCommand = {
            signature: commandSignature,
            key: api.createCommandKey(`appointment-${action}`, id)
          };
        }
        this.setData({ actionId: id });
        try {
          await api.updateAppointment(id, action, reason, this._pendingCommand.key);
          this._pendingCommand = null;
          await this.loadData(false);
          wx.showToast({ title: "预约状态已更新", icon: "success" });
        } catch (error) {
          wx.showToast({ title: error.message || "操作失败", icon: "none" });
        } finally {
          this.setData({ actionId: "" });
        }
      }
    });
  }
});
