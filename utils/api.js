const { getActiveRole, request, ROLE_KEY, setSession } = require("./request");

function loginCode() {
  return new Promise((resolve, reject) => {
    wx.login({ success: ({ code }) => code ? resolve(code) : reject(new Error("微信登录未返回 code")), fail: reject });
  });
}

async function ensureLogin() {
  const code = await loginCode();
  const data = await request("/api/v1/auth/wechat-login", {
    method: "POST",
    data: { code, activeRole: getActiveRole() }
  });
  setSession(data);
  return data;
}

async function switchRole(role) {
  const data = await request("/api/v1/auth/switch-role", { method: "POST", data: { role } });
  wx.setStorageSync("tutor_link_access_token", data.accessToken);
  wx.setStorageSync(ROLE_KEY, role);
  return data;
}

function listJobs(params = {}) {
  const query = Object.keys(params)
    .filter((key) => params[key] !== undefined && params[key] !== "")
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join("&");
  return request(`/api/v1/jobs${query ? `?${query}` : ""}`);
}

function createJob(form, publishType) {
  return request("/api/v1/jobs", {
    method: "POST",
    data: {
      type: publishType === "need" ? "TEACHING_NEED" : "TEACHER_OFFER",
      title: form.title,
      district: form.district,
      grade: form.grade,
      subject: form.subject,
      priceCents: Math.round(Number(form.price) * 100),
      priceUnit: "小时",
      settlement: "课结",
      schedule: form.schedule,
      description: form.description,
      contact: form.contact
    }
  });
}

function applyJob(jobId, coverLetter = "") {
  const idempotencyKey = `wx-${jobId}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return request(`/api/v1/jobs/${jobId}/applications`, {
    method: "POST",
    data: { coverLetter },
    header: { "Idempotency-Key": idempotencyKey }
  });
}

function favoriteJob(jobId, favorite) {
  return request(`/api/v1/jobs/${jobId}/favorite`, { method: favorite ? "POST" : "DELETE" });
}

function mapJob(item, index = 0) {
  const price = item.price !== undefined ? item.price : item.priceCents / 100;
  return {
    ...item,
    code: `#${String(index + 1).padStart(3, "0")}`,
    price: String(price),
    unit: `/${item.priceUnit || "小时"}`,
    role: item.type === "TEACHER_OFFER" ? "老师求带" : "家教需求",
    badge: item.type === "TEACHER_OFFER" ? "教师已认证" : "平台已审核",
    badgeTone: item.type === "TEACHER_OFFER" ? "purple" : "blue",
    publisher: item.owner ? item.owner.nickname : "平台用户",
    publisherRole: item.type === "TEACHER_OFFER" ? "认证老师" : "认证家长",
    students: item.studentInfo || "具体情况可沟通",
    distance: item.distanceMeters ? `${(item.distanceMeters / 1000).toFixed(1)}km` : item.area || item.district,
    x: 22 + (index * 17) % 62,
    y: 20 + (index * 23) % 56,
    color: ["#3478f6", "#574be7", "#28a866", "#ff9d2e"][index % 4]
  };
}

module.exports = { applyJob, createJob, ensureLogin, favoriteJob, getActiveRole, listJobs, mapJob, request, switchRole };
