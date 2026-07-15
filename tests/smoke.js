const assert = require("assert").strict;
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const storage = new Map();

const appStub = {
  globalData: { account: null, activeRole: "PARENT" },
  ensureAuth: async () => ({ id: "test-account", activeRole: "PARENT" }),
  switchActiveRole: async (role) => ({ activeRole: role, account: { id: "test-account", activeRole: role }, profileRefreshError: null })
};
global.getApp = () => appStub;
global.getCurrentPages = () => [{ route: "pages/index/index" }];
const capturedRequests = [];
global.wx = {
  getStorageSync(key) { return storage.has(key) ? storage.get(key) : ""; },
  setStorageSync(key, value) { storage.set(key, value); },
  removeStorageSync(key) { storage.delete(key); },
  request(options) {
    capturedRequests.push(options);
    options.success({ statusCode: 200, data: { success: true } });
  },
  login() {},
  showToast() {},
  showModal() {},
  navigateTo() {},
  redirectTo() {},
  switchTab() {},
  nextTick(callback) { callback(); },
  setNavigationBarTitle() {},
  stopPullDownRefresh() {}
};

function loadDefinition(relativePath, globalName) {
  let definition;
  global[globalName] = (value) => { definition = value; };
  const file = path.join(root, relativePath);
  delete require.cache[require.resolve(file)];
  require(file);
  assert.ok(definition, `${relativePath} should register with ${globalName}`);
  return definition;
}

const appConfig = JSON.parse(fs.readFileSync(path.join(root, "app.json"), "utf8"));
assert.deepEqual(appConfig.pages, [
  "pages/index/index",
  "pages/map/map",
  "pages/publish/publish",
  "pages/messages/messages",
  "pages/profile/profile",
  "pages/teacher-profile/teacher-profile",
  "pages/job-detail/job-detail",
  "pages/job-applications/job-applications",
  "pages/conversation/conversation",
  "pages/reviews/reviews"
]);
assert.equal(appConfig.tabBar.custom, true);
assert.equal(appConfig.requiredPrivateInfos.includes("getLocation"), true);
assert.equal(appConfig.requiredPrivateInfos.includes("chooseLocation"), true);

const publishTemplate = fs.readFileSync(path.join(root, "pages/publish/publish.wxml"), "utf8");
const profileTemplate = fs.readFileSync(path.join(root, "pages/profile/profile.wxml"), "utf8");
const teacherTemplate = fs.readFileSync(path.join(root, "pages/teacher-profile/teacher-profile.wxml"), "utf8");
const reviewsTemplate = fs.readFileSync(path.join(root, "pages/reviews/reviews.wxml"), "utf8");
const applicationsTemplate = fs.readFileSync(path.join(root, "pages/job-applications/job-applications.wxml"), "utf8");
const reviewsSource = fs.readFileSync(path.join(root, "pages/reviews/reviews.js"), "utf8");
const homeTemplate = fs.readFileSync(path.join(root, "pages/index/index.wxml"), "utf8");
const detailTemplate = fs.readFileSync(path.join(root, "pages/job-detail/job-detail.wxml"), "utf8");
const mapTemplate = fs.readFileSync(path.join(root, "pages/map/map.wxml"), "utf8");
const messagesTemplate = fs.readFileSync(path.join(root, "pages/messages/messages.wxml"), "utf8");
const conversationTemplate = fs.readFileSync(path.join(root, "pages/conversation/conversation.wxml"), "utf8");
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");
assert.match(publishTemplate, /picker[^>]+mode="region"/);
assert.doesNotMatch(publishTemplate, /data-field="address"/);
assert.match(profileTemplate, /picker[^>]+mode="region"/);
assert.match(profileTemplate, /input[^>]+type="nickname"/);
assert.match(profileTemplate, /profile-warning/);
assert.doesNotMatch(profileTemplate, /data-field="(?:city|district|address)"/);
assert.match(teacherTemplate, /picker[^>]+mode="region"/);
assert.doesNotMatch(teacherTemplate, /data-field="serviceDistricts"/);
assert.match(reviewsTemplate, /bindtap="selectRating"/);
assert.match(reviewsTemplate, /bindtap="submitReview"/);
assert.match(reviewsTemplate, /disabled="\{\{submitting\}\}"/);
assert.match(applicationsTemplate, /reviewLabel/);
assert.match(homeTemplate, /platformOverview\.brand\.name/);
assert.match(homeTemplate, /bindtap="retryPlatformOverview"/);
assert.match(detailTemplate, /当前身份/);
assert.match(mapTemplate, /picker[^>]+bindchange="changeDistrict"/);
assert.match(mapTemplate, /bindtap="openLocationSetting"/);
assert.match(messagesTemplate, /messages-role--\{\{roleTone\}\}/);
assert.match(messagesTemplate, /message-card__badge/);
assert.match(conversationTemplate, /conversation-identity__role--\{\{roleTone\}\}/);
assert.match(appSource, /switchActiveRole\(role\)/);
assert.equal((appSource.match(/switchActiveRole\(role\)/g) || []).length, 2, "role switching should have one public app method plus its queued recursion");
for (const rolePage of ["pages/index/index.js", "pages/profile/profile.js", "pages/job-detail/job-detail.js", "pages/reviews/reviews.js"]) {
  const source = fs.readFileSync(path.join(root, rolePage), "utf8");
  assert.doesNotMatch(source, /api\.switchRole\(/, `${rolePage} must use the app-level single-flight role switch`);
  assert.match(source, /不会自动申请、联系、发布、取消或评价/, `${rolePage} must explain role-switch safety before confirming`);
}
assert.doesNotMatch(fs.readFileSync(path.join(root, "pages/profile/profile.js"), "utf8"), /teacherProfile\.score/);
assert.doesNotMatch(fs.readFileSync(path.join(root, "pages/job-applications/job-applications.js"), "utf8"), /profile\.score/);
assert.doesNotMatch(reviewsSource, /target\.label\.replace/, "review target labels must be treated as optional API data");
assert.match(reviewsSource, /this\.data\.target\.role === "TEACHER"/, "pagination must be limited to public teacher review lists");

const pageFiles = appConfig.pages.map((page) => `${page}.js`);
const pages = pageFiles.map((file) => loadDefinition(file, "Page"));
const appDefinition = loadDefinition("app.js", "App");
assert.ok(pages.every((page) => page.data && typeof page === "object"));
assert.equal(typeof pages[0].loadData, "function");
assert.equal(typeof pages[1].loadNearby, "function");
assert.equal(typeof pages[1].openLocationSetting, "function");
assert.throws(() => pages[1].normalizeJobs("<html>tunnel warning</html>"), /数据格式异常/);
assert.deepEqual(pages[1].buildDistricts([
  { district: "南山区" },
  { district: "福田区" },
  { district: "南山区" }
]), ["全部区域", "南山区", "福田区"]);
assert.equal(typeof pages[4].saveNickname, "function");
assert.equal(typeof pages[7].confirmAndHandle, "function");
assert.equal(typeof pages[8].sendMessage, "function");
assert.equal(typeof pages[9].submitReview, "function");
assert.equal(typeof pages[9].switchRequiredRole, "function");
assert.equal(typeof appDefinition.switchActiveRole, "function");
assert.equal(appDefinition.switchActiveRole.length, 1, "role switching must not accept a business callback");
assert.equal(pages[9].data.rating, 0, "reviews must require an explicit star selection");
assert.equal(pages[9].validateReview.call({
  data: { rating: 0, selectedTags: [], content: "" }
}), "请选择1到5星评价");
assert.equal(pages[9].validateReview.call({
  data: { rating: 1, selectedTags: [], content: "字数太少" }
}), "1至2星评价请填写不少于10字的具体说明");
assert.equal(pages[9].validateReview.call({
  data: { rating: 2, selectedTags: ["专业耐心"], content: "这次合作存在比较具体的问题" }
}), "");

const tabbar = loadDefinition("custom-tab-bar/index.js", "Component");
assert.equal(tabbar.data.items.length, 5);
assert.equal(tabbar.data.items[2].key, "publish");

const requestClient = require(path.join(root, "utils/request"));
const apiClient = require(path.join(root, "utils/api"));
const locationPermission = require(path.join(root, "utils/location-permission"));
assert.equal(locationPermission.isUserCancel({ errMsg: "chooseLocation:fail cancel" }), true);
assert.deepEqual(apiClient.getTeacherApplicationEligibility({ auditStatus: "APPROVED" }), {
  canApply: true,
  actionLabel: "立即申请",
  reason: ""
});
assert.deepEqual(apiClient.getTeacherApplicationEligibility({ auditStatus: "PENDING", submittedAt: "2026-07-15T00:00:00Z" }), {
  canApply: false,
  actionLabel: "认证审核中",
  reason: "教师认证正在审核，通过后即可报名"
});
assert.equal(apiClient.getTeacherApplicationEligibility({ auditStatus: "REJECTED" }).actionLabel, "修改教师认证");
assert.equal(apiClient.getTeacherApplicationEligibility({}).actionLabel, "完善教师认证");
for (const method of ["createReview", "listTeacherReviews", "listMyReceivedReviews", "getCounterpartReputation"]) {
  assert.equal(typeof apiClient[method], "function", `${method} should be available to mini-program pages`);
}
assert.equal(typeof apiClient.getPlatformOverview, "function");

async function verifyRoleSwitchSingleFlight() {
  const originalSwitchRole = apiClient.switchRole;
  const originalGetAccount = apiClient.getAccount;
  let switchCalls = 0;
  let releaseSwitch;
  apiClient.switchRole = () => {
    switchCalls += 1;
    return new Promise((resolve) => { releaseSwitch = resolve; });
  };
  apiClient.getAccount = async () => { throw new Error("模拟资料刷新失败"); };
  const app = {
    ...appDefinition,
    _roleSwitchPromise: null,
    _roleSwitchTarget: "",
    globalData: { account: { id: "test-account", activeRole: "PARENT" }, activeRole: "PARENT", authReady: null, authError: "" }
  };
  const first = app.switchActiveRole("TEACHER");
  const second = app.switchActiveRole("TEACHER");
  assert.equal(first, second, "concurrent switches to the same role must share one promise");
  assert.equal(switchCalls, 1);
  releaseSwitch({ activeRole: "TEACHER" });
  const result = await first;
  assert.equal(app.globalData.activeRole, "TEACHER", "successful switch API must establish the new role immediately");
  assert.match(result.profileRefreshError.message, /资料刷新失败/);
  assert.equal(app.globalData.account, null, "failed profile refresh must remain retryable");
  apiClient.switchRole = originalSwitchRole;
  apiClient.getAccount = originalGetAccount;
}

const teacherCompletion = pages[4].normalizeAppointment({
  id: "appointment-teacher-completion",
  status: "CONFIRMED",
  job: { id: "job-1", ownerId: "parent-1", title: "数学辅导" },
  application: { teacherId: "teacher-1" },
  completionActions: {
    canAcknowledge: true,
    hasAcknowledged: false,
    waitingForOtherParty: false,
    requiresRoleSwitch: false
  },
  completionProgress: { parentAcknowledged: true, teacherAcknowledged: false, fullyAcknowledged: false },
  canReview: false,
  myReview: null,
  reviewTarget: { accountId: "parent-1", role: "PARENT", label: "本次合作家长" }
}, "teacher-1", "TEACHER");
assert.equal(teacherCompletion.canComplete, true, "teacher completion must follow server completionActions");
assert.equal(teacherCompletion.statusLabel, "待我确认完成");
const waitingCompletion = pages[4].normalizeAppointment({
  ...teacherCompletion,
  status: "CONFIRMED",
  completionActions: {
    canAcknowledge: false,
    hasAcknowledged: true,
    waitingForOtherParty: true,
    requiresRoleSwitch: false
  },
  completionProgress: { parentAcknowledged: false, teacherAcknowledged: true, fullyAcknowledged: false }
}, "teacher-1", "TEACHER");
assert.equal(waitingCompletion.canComplete, false);
assert.equal(waitingCompletion.statusLabel, "等待对方确认");

const homePage = {
  ...pages[0],
  data: {
    ...pages[0].data,
    activeRole: "TEACHER",
    teacherCanApply: false,
    teacherApplicationAction: "完善教师认证",
    teacherApplicationReason: "请先完善并提交教师认证资料",
    jobs: [{ id: "job-needs-certification", currentApplication: null, actionLabel: "完善教师认证" }]
  },
  setData(update) { this.data = { ...this.data, ...update }; }
};
let navigatedTo = "";
let applicationCalls = 0;
const originalNavigateTo = wx.navigateTo;
const originalApplyJob = apiClient.applyJob;
wx.navigateTo = ({ url }) => { navigatedTo = url; };
apiClient.applyJob = async () => { applicationCalls += 1; };
homePage.applyJob.call(homePage, { currentTarget: { dataset: { id: "job-needs-certification" } } });
assert.equal(navigatedTo, "/pages/teacher-profile/teacher-profile");
assert.equal(applicationCalls, 0, "an unapproved teacher must not send an application request");
wx.navigateTo = originalNavigateTo;
apiClient.applyJob = originalApplyJob;

const firstDeviceId = requestClient.getDeviceId();
assert.equal(requestClient.getDeviceId(), firstDeviceId);
assert.ok(storage.has(requestClient.DEVICE_KEY));
for (const forbidden of ["applications", "favorites", "messages", "posts", "settings"]) {
  assert.equal(storage.has(forbidden), false, `business data must not be stored locally: ${forbidden}`);
}

for (const file of [...pageFiles, "app.js", "utils/api.js", "utils/request.js"]) {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  assert.doesNotMatch(source, /utils\/(data|store)|require\([^)]*(?:data|store)/, `${file} must use database APIs`);
}

requestClient.request("/api/v1/conversations/00000000-0000-4000-8000-000000000000/read", { method: "POST" })
  .then(async () => {
    await verifyRoleSwitchSingleFlight();
    assert.equal(capturedRequests.length, 1);
    assert.equal(capturedRequests[0].method, "POST");
    assert.deepEqual(capturedRequests[0].data, {}, "body-less JSON writes must send a valid empty object");
    const expectedNgrokBypass = requestClient.API_BASE_URL.includes(".ngrok-free.") ? "true" : undefined;
    assert.equal(capturedRequests[0].header["ngrok-skip-browser-warning"], expectedNgrokBypass, "the ngrok bypass header must only be sent through a free ngrok tunnel");

    await apiClient.createReview("appointment-1", {
      rating: 5,
      tags: ["专业耐心"],
      content: "合作非常顺利"
    }, "fixed-review-key");
    const createReviewRequest = capturedRequests[capturedRequests.length - 1];
    assert.match(createReviewRequest.url, /\/api\/v1\/appointments\/appointment-1\/reviews$/);
    assert.equal(createReviewRequest.header["Idempotency-Key"], "fixed-review-key");
    assert.deepEqual(createReviewRequest.data, { rating: 5, tags: ["专业耐心"], content: "合作非常顺利" });

    await apiClient.acceptApplication("application-1", "  欢迎加入  ", "fixed-accept-command-key");
    const acceptCommandRequest = capturedRequests[capturedRequests.length - 1];
    assert.match(acceptCommandRequest.url, /\/api\/v1\/applications\/application-1\/accept$/);
    assert.equal(acceptCommandRequest.header["Idempotency-Key"], "fixed-accept-command-key");
    assert.deepEqual(acceptCommandRequest.data, { note: "  欢迎加入  " });

    await apiClient.updateAppointment("appointment-1", "cancel", "时间冲突", "fixed-appointment-command-key");
    const appointmentCommandRequest = capturedRequests[capturedRequests.length - 1];
    assert.match(appointmentCommandRequest.url, /\/api\/v1\/appointments\/appointment-1\/cancel$/);
    assert.equal(appointmentCommandRequest.header["Idempotency-Key"], "fixed-appointment-command-key");
    assert.deepEqual(appointmentCommandRequest.data, { reason: "时间冲突" });
    assert.ok(apiClient.createCommandKey("appointment-cancel", "appointment-1").length <= 128);

    await apiClient.listTeacherReviews("teacher-1", { cursor: "cursor-1", limit: 10 });
    assert.match(capturedRequests[capturedRequests.length - 1].url, /\/api\/v1\/teachers\/teacher-1\/reviews\?cursor=cursor-1&limit=10$/);
    await apiClient.listMyReceivedReviews({ cursor: "cursor-2", limit: 5 });
    assert.match(capturedRequests[capturedRequests.length - 1].url, /\/api\/v1\/me\/reviews\/received\?cursor=cursor-2&limit=5$/);
    await apiClient.getCounterpartReputation("appointment-1");
    assert.match(capturedRequests[capturedRequests.length - 1].url, /\/api\/v1\/appointments\/appointment-1\/counterpart-reputation$/);
    await apiClient.getPlatformOverview();
    assert.match(capturedRequests[capturedRequests.length - 1].url, /\/api\/v1\/platform\/overview$/);
    await apiClient.sendConversationMessage("conversation-1", "保持幂等的消息", "fixed-client-message-id");
    const sendMessageRequest = capturedRequests[capturedRequests.length - 1];
    assert.match(sendMessageRequest.url, /\/api\/v1\/conversations\/conversation-1\/messages$/);
    assert.deepEqual(sendMessageRequest.data, { clientMessageId: "fixed-client-message-id", content: "保持幂等的消息" });

    const originalGetSetting = wx.getSetting;
    const originalOpenSetting = wx.openSetting;
    let locationRetryCount = 0;
    wx.getSetting = ({ success }) => success({ authSetting: { "scope.userLocation": false } });
    assert.deepEqual(await locationPermission.getLocationPermissionState({ errMsg: "getLocation:fail auth deny" }), { denied: true });
    wx.openSetting = ({ success }) => success({ authSetting: { "scope.userLocation": true } });
    locationPermission.openLocationSetting(() => { locationRetryCount += 1; });
    assert.equal(locationRetryCount, 1, "granting location permission should immediately retry the interrupted action");
    const originalListAllJobs = apiClient.listAllJobs;
    apiClient.listAllJobs = async () => ({ items: [
      { id: "fallback-job-1", title: "南山数学", district: "南山区", status: "PUBLISHED" },
      { id: "fallback-job-2", title: "福田英语", district: "福田区", status: "PUBLISHED" }
    ] });
    const fallbackMapPage = {
      ...pages[1],
      data: { ...pages[1].data },
      getLocation: async () => { throw new Error("getLocation:fail auth deny"); },
      setData(update, callback) { this.data = { ...this.data, ...update }; if (callback) callback(); }
    };
    await fallbackMapPage.loadNearby.call(fallbackMapPage);
    assert.equal(fallbackMapPage.data.fallbackMode, true);
    assert.equal(fallbackMapPage.data.locationPermissionDenied, true);
    assert.deepEqual(fallbackMapPage.data.districts, ["全部区域", "南山区", "福田区"]);
    assert.equal(fallbackMapPage.data.markers.length, 0, "location fallback must never invent map coordinates");
    apiClient.listAllJobs = originalListAllJobs;
    wx.getSetting = originalGetSetting;
    wx.openSetting = originalOpenSetting;

    const originalListNotifications = apiClient.listNotifications;
    const originalListConversations = apiClient.listConversations;
    storage.set(requestClient.ROLE_KEY, "TEACHER");
    apiClient.listNotifications = async () => ({ unexpected: "html or malformed payload" });
    apiClient.listConversations = async () => ([{
      id: "conversation-ui-1",
      viewerRole: "TEACHER",
      members: [{ account: { id: "peer-1", nickname: "一个非常非常长的家长昵称" } }],
      messages: [{ content: "这是一段用于验证长消息省略显示且不会挤压时间和未读徽标的正文", createdAt: new Date().toISOString() }],
      unreadCount: 120,
      updatedAt: new Date().toISOString()
    }]);
    const partialMessagesPage = {
      ...pages[3],
      data: { ...pages[3].data },
      setData(update, callback) { this.data = { ...this.data, ...update }; if (callback) callback(); }
    };
    await partialMessagesPage.loadMessages.call(partialMessagesPage, false);
    assert.equal(partialMessagesPage.data.error, "");
    assert.match(partialMessagesPage.data.warning, /平台通知暂未同步/);
    assert.equal(partialMessagesPage.data.messages.length, 1, "a malformed notification payload must not hide healthy conversations");
    assert.equal(partialMessagesPage.data.messages[0].unreadLabel, "99+");
    assert.equal(partialMessagesPage.data.messages[0].roleLabel, "老师沟通");
    assert.equal(partialMessagesPage.data.roleLabel, "老师沟通");
    storage.set(requestClient.ROLE_KEY, "PARENT");
    apiClient.listConversations = async () => ({ unexpected: "malformed after role switch" });
    await partialMessagesPage.loadMessages.call(partialMessagesPage, false);
    assert.equal(partialMessagesPage.data.roleLabel, "家长沟通");
    assert.equal(partialMessagesPage.data.messages.length, 0, "a failed role switch refresh must never expose the previous role's conversations");
    assert.match(partialMessagesPage.data.error, /数据格式异常/);
    apiClient.listNotifications = originalListNotifications;
    apiClient.listConversations = originalListConversations;

    let roleReloadCount = 0;
    const roleChangedConversationPage = {
      ...pages[8],
      _hasLoadedOnce: true,
      data: {
        ...pages[8].data,
        conversationId: "teacher-only-conversation",
        activeRole: "TEACHER",
        roleLabel: "老师沟通",
        roleTone: "teacher",
        loadedRole: "TEACHER",
        loaded: true,
        messages: [{ id: "teacher-private-message" }],
        inputValue: "老师身份下的草稿"
      },
      setData(update, callback) { this.data = { ...this.data, ...update }; if (callback) callback(); },
      initialize() { roleReloadCount += 1; }
    };
    pages[8].onShow.call(roleChangedConversationPage);
    assert.equal(roleChangedConversationPage.data.roleLabel, "家长沟通");
    assert.equal(roleChangedConversationPage.data.messages.length, 0, "switching role must immediately clear the previous role's open conversation");
    assert.equal(roleChangedConversationPage.data.inputValue, "");
    assert.equal(roleReloadCount, 1);

    const originalSendConversationMessage = apiClient.sendConversationMessage;
    const originalCreateClientMessageId = apiClient.createClientMessageId;
    const sentClientIds = [];
    apiClient.createClientMessageId = () => "stable-client-message-id";
    apiClient.sendConversationMessage = async (id, content, clientMessageId) => {
      sentClientIds.push(clientMessageId);
      if (sentClientIds.length === 1) throw new Error("模拟发送响应中断");
      return { id: "message-retry-success", content, createdAt: new Date().toISOString() };
    };
    const retryConversationPage = {
      ...pages[8],
      data: {
        ...pages[8].data,
        conversationId: "conversation-retry",
        accountId: "test-account",
        loaded: true,
        loading: false,
        inputValue: "  重试时保持同一条消息  ",
        messages: []
      },
      setData(update, callback) { this.data = { ...this.data, ...update }; if (callback) callback(); }
    };
    await retryConversationPage.sendMessage.call(retryConversationPage);
    assert.equal(retryConversationPage.data.inputValue, "  重试时保持同一条消息  ");
    assert.equal(retryConversationPage._pendingMessage.clientMessageId, "stable-client-message-id");
    await retryConversationPage.sendMessage.call(retryConversationPage);
    assert.deepEqual(sentClientIds, ["stable-client-message-id", "stable-client-message-id"], "an unchanged retry must reuse clientMessageId");
    assert.equal(retryConversationPage._pendingMessage, null);
    assert.equal(retryConversationPage.data.inputValue, "");
    apiClient.sendConversationMessage = originalSendConversationMessage;
    apiClient.createClientMessageId = originalCreateClientMessageId;

    const originalOverview = apiClient.getPlatformOverview;
    apiClient.getPlatformOverview = async () => ({
      brand: { name: "家教直聘", slogan: "让每次匹配更安心" },
      trustHighlights: ["教师资料经平台审核", "真实合作才能评价"],
      metrics: { approvedTeachers: 2, publishedJobs: 3, completedAppointments: 4, publishedReviews: 5 }
    });
    const overviewPage = {
      ...pages[0],
      data: { ...pages[0].data, jobs: [{ id: "preserved-job" }] },
      setData(update) { this.data = { ...this.data, ...update }; }
    };
    assert.equal(await overviewPage.loadPlatformOverview.call(overviewPage), true);
    assert.deepEqual(overviewPage.data.platformMetricItems.map((item) => item.value), [2, 3, 4, 5]);
    apiClient.getPlatformOverview = async () => { throw new Error("模拟概览中断"); };
    assert.equal(await overviewPage.loadPlatformOverview.call(overviewPage), false);
    assert.equal(overviewPage.data.jobs[0].id, "preserved-job", "overview failure must not clear the jobs feed");
    assert.equal(overviewPage.data.platformMetricItems.length, 0, "overview failure must not display fake zero metrics");
    assert.match(overviewPage.data.platformOverviewError, /概览中断/);
    apiClient.getPlatformOverview = originalOverview;

    const originalShowModal = wx.showModal;
    let pendingModal;
    let modalCount = 0;
    let confirmedSwitches = 0;
    wx.showModal = (options) => { pendingModal = options; modalCount += 1; };
    const rolePromptPage = {
      ...pages[0],
      data: { ...pages[0].data, activeRole: "PARENT", rolePromptOpen: false, actionId: "" },
      setData(update) { this.data = { ...this.data, ...update }; },
      performRoleSwitch(role) { confirmedSwitches += role === "TEACHER" ? 1 : 0; }
    };
    rolePromptPage.switchRole.call(rolePromptPage);
    rolePromptPage.switchRole.call(rolePromptPage);
    assert.equal(modalCount, 1, "rapid role-switch taps must open only one confirmation");
    pendingModal.success({ confirm: false });
    assert.equal(confirmedSwitches, 0, "cancelling role confirmation must not trigger a switch request");
    rolePromptPage.switchRole.call(rolePromptPage);
    pendingModal.success({ confirm: true });
    assert.equal(confirmedSwitches, 1);
    wx.showModal = originalShowModal;

    let detailRoleRequests = 0;
    let detailTabSwitches = 0;
    const originalSwitchTab = wx.switchTab;
    wx.switchTab = () => { detailTabSwitches += 1; };
    const ownerMismatchDetail = {
      ...pages[6],
      data: { ...pages[6].data, ownerRoleMismatch: true, ownerRole: "TEACHER" },
      requestRoleSwitch(role) { if (role === "TEACHER") detailRoleRequests += 1; }
    };
    ownerMismatchDetail.openMyPosts.call(ownerMismatchDetail);
    assert.equal(detailRoleRequests, 1);
    assert.equal(detailTabSwitches, 0, "detail role switch must stay put instead of opening a business page");
    wx.switchTab = originalSwitchTab;

    const originalCreateReview = apiClient.createReview;
    apiClient.createReview = async () => { throw new Error("模拟网络中断"); };
    const retryReviewPage = {
      ...pages[9],
      data: {
        ...pages[9].data,
        appointmentId: "appointment-retry",
        appointment: { id: "appointment-retry", canReview: true },
        rating: 5,
        selectedTags: ["专业耐心"],
        content: "这次合作沟通顺畅",
        submissionKey: "same-key-after-failure"
      },
      setData(update) { this.data = { ...this.data, ...update }; }
    };
    await retryReviewPage.submitReview.call(retryReviewPage);
    assert.equal(retryReviewPage.data.submissionKey, "same-key-after-failure", "failed review retries must retain the same idempotency key");
    assert.equal(retryReviewPage.data.content, "这次合作沟通顺畅", "failed review submissions must retain form input");
    assert.equal(retryReviewPage.data.submitting, false);
    apiClient.createReview = originalCreateReview;

    let invalidTeacherListCalls = 0;
    const originalListTeacherReviews = apiClient.listTeacherReviews;
    apiClient.listTeacherReviews = async () => {
      invalidTeacherListCalls += 1;
      return { items: [], nextCursor: null };
    };
    const parentSummaryPage = {
      ...pages[9],
      data: {
        ...pages[9].data,
        receivedMode: false,
        accountId: "",
        target: { accountId: "parent-1", role: "PARENT", label: null },
        nextCursor: "unexpected-parent-cursor"
      },
      setData(update) { this.data = { ...this.data, ...update }; }
    };
    await parentSummaryPage.loadMore.call(parentSummaryPage);
    assert.equal(invalidTeacherListCalls, 0, "parent appointment summaries must never call the public teacher-review route");
    apiClient.listTeacherReviews = originalListTeacherReviews;

    const profileApiMethods = [
      "getAccount",
      "getMineJobs",
      "listFavoriteJobs",
      "listAllParentApplications",
      "getPreferences",
      "listAppointments",
      "listMyReceivedReviews"
    ];
    const originalProfileApi = Object.fromEntries(profileApiMethods.map((method) => [method, apiClient[method]]));
    apiClient.getAccount = async () => ({
      id: "test-account",
      nickname: "测试家长",
      activeRole: "PARENT",
      parentProfile: { province: "广东省", city: "深圳市", district: "南山区" },
      teacherProfile: {}
    });
    apiClient.getMineJobs = async () => ({ data: { items: [{
      id: "profile-job",
      ownerId: "test-account",
      type: "TEACHING_NEED",
      title: "高一数学辅导",
      status: "PUBLISHED"
    }] } });
    apiClient.listFavoriteJobs = async () => "<html>临时网关提示</html>";
    apiClient.listAllParentApplications = async () => ({ results: [{
      id: "profile-application",
      jobId: "profile-job",
      status: "PENDING",
      job: { id: "profile-job", title: "高一数学辅导" },
      teacher: { nickname: "陈老师" }
    }] });
    apiClient.getPreferences = async () => { throw new Error("偏好接口暂不可用"); };
    apiClient.listAppointments = async () => ({ data: [{
      id: "profile-appointment",
      status: "CONFIRMED",
      job: { id: "profile-job", ownerId: "test-account", title: "高一数学辅导" },
      application: { teacherId: "teacher-account" },
      completionActions: {}
    }] });
    apiClient.listMyReceivedReviews = async () => ({
      items: [],
      nextCursor: null,
      summary: { displayAverage: null, count: 0, levelLabel: "评价积累中" }
    });
    const resilientProfilePage = {
      ...pages[4],
      data: { ...pages[4].data, settings: { ...pages[4].data.settings } },
      setData(update, callback) { this.data = { ...this.data, ...update }; if (callback) callback(); }
    };
    assert.equal(await resilientProfilePage.loadData.call(resilientProfilePage, false), true);
    assert.equal(resilientProfilePage.data.error, "", "one malformed optional collection must not fail the profile page");
    assert.equal(resilientProfilePage.data.posts.length, 1, "nested data.items envelopes should be accepted");
    assert.equal(resilientProfilePage.data.applications.length, 1, "results envelopes should be accepted");
    assert.equal(resilientProfilePage.data.appointments.length, 1, "data array envelopes should be accepted");
    assert.equal(resilientProfilePage.data.favorites.length, 0);
    assert.match(resilientProfilePage.data.warning, /我的收藏/);
    assert.match(resilientProfilePage.data.warning, /偏好设置/);
    assert.match(resilientProfilePage.data.warning, /其他功能仍可正常使用/);
    for (const method of profileApiMethods) apiClient[method] = originalProfileApi[method];

    const originalUpdateAccount = apiClient.updateAccount;
    let nicknamePayload;
    apiClient.updateAccount = async (payload) => {
      nicknamePayload = payload;
      return { id: "test-account", nickname: payload.nickname, activeRole: "PARENT" };
    };
    const profilePage = {
      ...pages[4],
      data: {
        ...pages[4].data,
        account: { id: "test-account", nickname: "旧昵称", activeRole: "PARENT" },
        nicknameDraft: "  新昵称  "
      },
      setData(update) { this.data = { ...this.data, ...update }; }
    };
    await profilePage.saveNickname.call(profilePage);
    assert.deepEqual(nicknamePayload, { nickname: "新昵称" });
    assert.equal(profilePage.data.account.nickname, "新昵称");
    assert.equal(profilePage.data.accountInitial, "新");
    assert.equal(profilePage.data.showNicknameEditor, false);
    apiClient.updateAccount = originalUpdateAccount;

    console.log("Smoke checks passed: database-only client flows, permission-aware location fallback, role-scoped resilient message rendering, stable chat retries, verified reviews and commands, nickname editing, valid empty JSON writes, 10 pages, and native tab bar.");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
