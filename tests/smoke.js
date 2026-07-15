const assert = require("assert").strict;
const path = require("path");

const root = path.resolve(__dirname, "..");
const storage = new Map();

global.getApp = () => ({
  globalData: {
    storageKeys: {
      applications: "applications",
      favorites: "favorites",
      messages: "messages",
      posts: "posts",
      settings: "settings"
    }
  }
});

global.wx = {
  getStorageSync(key) {
    return storage.has(key) ? storage.get(key) : "";
  },
  setStorageSync(key, value) {
    storage.set(key, value);
  },
  showToast() {},
  showModal() {},
  navigateTo() {},
  redirectTo() {},
  setNavigationBarTitle() {},
  stopPullDownRefresh() {}
};

function loadDefinition(relativePath, globalName) {
  let definition;
  global[globalName] = (value) => {
    definition = value;
  };
  const file = path.join(root, relativePath);
  delete require.cache[require.resolve(file)];
  require(file);
  assert.ok(definition, `${relativePath} should register with ${globalName}`);
  return definition;
}

const { JOBS, CATEGORIES, FILTERS, findJob } = require(path.join(root, "utils/data"));
assert.equal(JOBS.length, 6);
assert.equal(new Set(JOBS.map((job) => job.id)).size, JOBS.length);
assert.ok(JOBS.every((job) => job.title && job.price && job.district && job.description));
assert.equal(CATEGORIES.length, 3);
assert.ok(FILTERS.district.includes("南山区"));
assert.equal(findJob("job-001").subject, "数学");

const store = require(path.join(root, "utils/store"));
assert.deepEqual(store.appendUnique("applications", "job-001"), ["job-001"]);
assert.deepEqual(store.appendUnique("applications", "job-001"), ["job-001"]);
assert.deepEqual(store.toggleInList("favorites", "job-002"), ["job-002"]);
assert.deepEqual(store.toggleInList("favorites", "job-002"), []);

const pageFiles = [
  "pages/index/index.js",
  "pages/map/map.js",
  "pages/publish/publish.js",
  "pages/messages/messages.js",
  "pages/profile/profile.js",
  "pages/teacher-profile/teacher-profile.js",
  "pages/job-detail/job-detail.js"
];

const pages = pageFiles.map((file) => loadDefinition(file, "Page"));
assert.ok(pages.every((page) => page.data && typeof page === "object"));
assert.equal(pages[0].matchesGrade("初二", "初中"), true);
assert.equal(pages[0].matchesGrade("高一", "初中"), false);

const tabbar = loadDefinition("components/app-tabbar/app-tabbar.js", "Component");
assert.equal(tabbar.data.items.length, 5);
assert.equal(tabbar.data.items[2].key, "publish");

console.log("Smoke checks passed: data, storage, 7 pages, and tab bar.");
