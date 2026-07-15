const assert = require("assert").strict;
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const storage = new Map();

global.getApp = () => ({
  globalData: { account: null, activeRole: "PARENT" },
  ensureAuth: async () => ({ id: "test-account", activeRole: "PARENT" })
});
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
  "pages/conversation/conversation"
]);
assert.equal(appConfig.tabBar.custom, true);
assert.equal(appConfig.requiredPrivateInfos.includes("getLocation"), true);
assert.equal(appConfig.requiredPrivateInfos.includes("chooseLocation"), true);

const publishTemplate = fs.readFileSync(path.join(root, "pages/publish/publish.wxml"), "utf8");
const profileTemplate = fs.readFileSync(path.join(root, "pages/profile/profile.wxml"), "utf8");
const teacherTemplate = fs.readFileSync(path.join(root, "pages/teacher-profile/teacher-profile.wxml"), "utf8");
assert.match(publishTemplate, /picker[^>]+mode="region"/);
assert.doesNotMatch(publishTemplate, /data-field="address"/);
assert.match(profileTemplate, /picker[^>]+mode="region"/);
assert.doesNotMatch(profileTemplate, /data-field="(?:city|district|address)"/);
assert.match(teacherTemplate, /picker[^>]+mode="region"/);
assert.doesNotMatch(teacherTemplate, /data-field="serviceDistricts"/);

const pageFiles = appConfig.pages.map((page) => `${page}.js`);
const pages = pageFiles.map((file) => loadDefinition(file, "Page"));
assert.ok(pages.every((page) => page.data && typeof page === "object"));
assert.equal(typeof pages[0].loadData, "function");
assert.equal(typeof pages[1].loadNearby, "function");
assert.equal(typeof pages[7].confirmAndHandle, "function");
assert.equal(typeof pages[8].sendMessage, "function");

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
  .then(() => {
    assert.equal(capturedRequests.length, 1);
    assert.equal(capturedRequests[0].method, "POST");
    assert.deepEqual(capturedRequests[0].data, {}, "body-less JSON writes must send a valid empty object");
    console.log("Smoke checks passed: database-only client flows, teacher application eligibility, valid empty JSON writes, 9 pages, stable session identity, and native tab bar.");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
