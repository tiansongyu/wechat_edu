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
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");
assert.match(publishTemplate, /picker[^>]+mode="region"/);
assert.doesNotMatch(publishTemplate, /data-field="address"/);
assert.match(profileTemplate, /picker[^>]+mode="region"/);
assert.match(profileTemplate, /input[^>]+type="nickname"/);
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

    console.log("Smoke checks passed: database-only client flows, bidirectional completion, verified review API contracts and idempotency, nickname editing, teacher application eligibility, valid empty JSON writes, environment-aware tunnel headers, 10 pages, stable session identity, and native tab bar.");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
