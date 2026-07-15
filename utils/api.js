const requestClient = require("./request");

const { getActiveRole, getDeviceId, request, setSession } = requestClient;

function queryString(params = {}) {
  const query = Object.keys(params)
    .filter((key) => params[key] !== undefined && params[key] !== null && params[key] !== "")
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join("&");
  return query ? `?${query}` : "";
}

function uuidV4() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function ensureLogin() {
  return requestClient.ensureAuthenticated();
}

async function switchRole(role) {
  const data = await request("/api/v1/auth/switch-role", { method: "POST", data: { role } });
  setSession(data);
  return data;
}

function logout() {
  const refreshToken = wx.getStorageSync(requestClient.REFRESH_KEY);
  return request("/api/v1/auth/logout", { method: "POST", data: { refreshToken } })
    .finally(() => requestClient.clearSession());
}

function getAccount() {
  return request("/api/v1/auth/me");
}

function updateAccount(data) {
  return request("/api/v1/auth/me", { method: "PATCH", data });
}

function listJobs(params = {}) {
  return request(`/api/v1/jobs${queryString(params)}`);
}

async function listAllJobs(params = {}) {
  const items = [];
  const seen = new Set();
  let cursor = "";
  do {
    const page = await listJobs({ ...params, limit: 50, cursor: cursor || undefined });
    for (const item of page.items || []) {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        items.push(item);
      }
    }
    const nextCursor = page.nextCursor || "";
    if (!nextCursor || nextCursor === cursor) break;
    cursor = nextCursor;
  } while (cursor);
  return { items, nextCursor: null };
}

function getJob(id) {
  return request(`/api/v1/jobs/${id}`);
}

function getMineJobs() {
  return request("/api/v1/jobs/mine");
}

function listFavoriteJobs() {
  return request("/api/v1/jobs/favorites");
}

function nearbyJobs(params) {
  return request(`/api/v1/jobs/nearby${queryString(params)}`);
}

function createJob(form, publishType) {
  const price = Number(form.price);
  return request("/api/v1/jobs", {
    method: "POST",
    data: {
      type: publishType === "need" ? "TEACHING_NEED" : "TEACHER_OFFER",
      title: form.title.trim(),
      province: form.province || undefined,
      city: form.city || undefined,
      district: form.district,
      area: form.area ? form.area.trim() : undefined,
      grade: form.grade,
      subject: form.subject,
      priceCents: Math.round(price * 100),
      priceUnit: "小时",
      settlement: form.settlement || "课结",
      schedule: form.schedule.trim(),
      description: form.description.trim(),
      studentInfo: form.studentInfo ? form.studentInfo.trim() : undefined,
      address: form.address ? form.address.trim() : undefined,
      contact: form.contact.trim(),
      latitude: form.latitude === "" || form.latitude === undefined ? undefined : Number(form.latitude),
      longitude: form.longitude === "" || form.longitude === undefined ? undefined : Number(form.longitude)
    }
  });
}

function updateJob(id, form, version) {
  return request(`/api/v1/jobs/${id}`, {
    method: "PATCH",
    data: {
      title: form.title.trim(),
      province: form.province || undefined,
      city: form.city || undefined,
      district: form.district,
      area: form.area ? form.area.trim() : undefined,
      grade: form.grade,
      subject: form.subject,
      priceCents: Math.round(Number(form.price) * 100),
      priceUnit: "小时",
      settlement: form.settlement || "课结",
      schedule: form.schedule.trim(),
      description: form.description.trim(),
      studentInfo: form.studentInfo ? form.studentInfo.trim() : undefined,
      address: form.address ? form.address.trim() : undefined,
      contact: form.contact.trim(),
      latitude: form.latitude === "" || form.latitude === undefined ? undefined : Number(form.latitude),
      longitude: form.longitude === "" || form.longitude === undefined ? undefined : Number(form.longitude),
      version
    }
  });
}

function closeJob(id) {
  return request(`/api/v1/jobs/${id}/close`, { method: "POST" });
}

function reopenJob(id) {
  return request(`/api/v1/jobs/${id}/reopen`, { method: "POST" });
}

function applyJob(jobId, coverLetter = "") {
  const idempotencyKey = `${getDeviceId()}-${jobId}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return request(`/api/v1/jobs/${jobId}/applications`, {
    method: "POST",
    data: { coverLetter },
    header: { "Idempotency-Key": idempotencyKey }
  });
}

function listTeacherApplications() {
  return request("/api/v1/teacher/applications");
}

function cancelApplication(id, note = "") {
  return request(`/api/v1/applications/${id}/cancel`, { method: "POST", data: { note } });
}

function listParentApplications(jobId) {
  return request(`/api/v1/parent/jobs/${jobId}/applications`);
}

function listAllParentApplications() {
  return request("/api/v1/parent/applications");
}

function acceptApplication(id, note = "") {
  return request(`/api/v1/applications/${id}/accept`, { method: "POST", data: { note } });
}

function rejectApplication(id, note = "") {
  return request(`/api/v1/applications/${id}/reject`, { method: "POST", data: { note } });
}

function favoriteJob(jobId, favorite) {
  return request(`/api/v1/jobs/${jobId}/favorite`, { method: favorite ? "POST" : "DELETE" });
}

function getPreferences() {
  return request("/api/v1/preferences");
}

function updatePreferences(data) {
  return request("/api/v1/preferences", { method: "PATCH", data });
}

function listAppointments() {
  return request("/api/v1/appointments");
}

function updateAppointment(id, action, note = "") {
  return request(`/api/v1/appointments/${id}/${action}`, { method: "POST", data: { reason: note } });
}

function createReview(appointmentId, data, idempotencyKey) {
  const key = idempotencyKey || `review-${getDeviceId()}-${appointmentId}-${uuidV4()}`;
  return request(`/api/v1/appointments/${appointmentId}/reviews`, {
    method: "POST",
    data: {
      rating: Number(data.rating),
      tags: Array.isArray(data.tags) ? data.tags : [],
      content: String(data.content || "").trim() || undefined
    },
    header: { "Idempotency-Key": key }
  });
}

function listTeacherReviews(accountId, params = {}) {
  return request(`/api/v1/teachers/${accountId}/reviews${queryString({
    cursor: params.cursor,
    limit: params.limit
  })}`);
}

function listMyReceivedReviews(params = {}) {
  return request(`/api/v1/me/reviews/received${queryString({
    cursor: params.cursor,
    limit: params.limit
  })}`);
}

function getCounterpartReputation(appointmentId) {
  return request(`/api/v1/appointments/${appointmentId}/counterpart-reputation`);
}

function listNotifications() {
  return request("/api/v1/notifications");
}

function markNotificationRead(id) {
  return request(`/api/v1/notifications/${id}/read`, { method: "POST" });
}

function markAllNotificationsRead() {
  return request("/api/v1/notifications/read-all", { method: "POST" });
}

function listConversations() {
  return request("/api/v1/conversations");
}

function startConversation(memberId, jobId) {
  return request("/api/v1/conversations", { method: "POST", data: { memberId, jobId } });
}

function listConversationMessages(id, cursor) {
  return request(`/api/v1/conversations/${id}/messages${queryString({ cursor })}`);
}

function sendConversationMessage(id, content) {
  const clientMessageId = uuidV4();
  return request(`/api/v1/conversations/${id}/messages`, {
    method: "POST",
    data: { clientMessageId, content }
  });
}

function markConversationRead(id) {
  return request(`/api/v1/conversations/${id}/read`, { method: "POST" });
}

function getTeacherProfile() {
  return request("/api/v1/profiles/teacher");
}

function getTeacherApplicationEligibility(profile = {}) {
  if (profile && profile.auditStatus === "APPROVED") {
    return { canApply: true, actionLabel: "立即申请", reason: "" };
  }
  if (profile && profile.auditStatus === "PENDING" && profile.submittedAt) {
    return {
      canApply: false,
      actionLabel: "认证审核中",
      reason: "教师认证正在审核，通过后即可报名"
    };
  }
  if (profile && profile.auditStatus === "REJECTED") {
    return {
      canApply: false,
      actionLabel: "修改教师认证",
      reason: profile.auditNote || "教师认证未通过，请修改资料后重新提交"
    };
  }
  return {
    canApply: false,
    actionLabel: "完善教师认证",
    reason: "请先完善并提交教师认证资料"
  };
}

function updateTeacherProfile(data) {
  return request("/api/v1/profiles/teacher", { method: "PATCH", data });
}

function updateParentProfile(data) {
  return request("/api/v1/profiles/parent", { method: "PATCH", data });
}

function createUploadUrl(data) {
  return request("/api/v1/files/upload-url", { method: "POST", data });
}

function addTeacherCertification(data) {
  return request("/api/v1/profiles/teacher/certifications", { method: "POST", data });
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  }
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function normalizeJob(item) {
  if (!item) return null;
  const price = item.price !== undefined ? item.price : Number(item.priceCents || 0) / 100;
  const distanceValue = item.distanceMeters !== undefined && item.distanceMeters !== null
    ? item.distanceMeters < 1000
      ? `${Math.round(Number(item.distanceMeters))}m`
      : `${(Number(item.distanceMeters) / 1000).toFixed(1)}km`
    : "";
  const distance = distanceValue && item.locationApproximate ? `约 ${distanceValue}` : distanceValue;
  return {
    ...item,
    price: String(price),
    unit: `/${item.priceUnit || "小时"}`,
    typeLabel: item.type === "TEACHER_OFFER" ? "老师求带" : "家教需求",
    statusLabel: {
      DRAFT: "草稿",
      PENDING: "审核中",
      PUBLISHED: "已发布",
      REJECTED: "需修改",
      CLOSED: "已关闭"
    }[item.status] || item.status || "",
    publisher: item.owner && item.owner.nickname ? item.owner.nickname : "平台用户",
    publisherInitial: item.owner && item.owner.nickname ? item.owner.nickname.slice(0, 1) : "人",
    publisherAvatar: item.owner && item.owner.avatarUrl ? item.owner.avatarUrl : "",
    distance,
    locationLabel: item.district === "线上"
      ? "线上授课"
      : [item.city, item.district, item.area].filter(Boolean).join(" · "),
    createdLabel: formatDate(item.createdAt || item.publishedAt),
    favorite: Boolean(item.favorite),
    currentApplication: item.currentApplication || null
  };
}

module.exports = {
  addTeacherCertification,
  acceptApplication,
  applyJob,
  cancelApplication,
  closeJob,
  createJob,
  createReview,
  createUploadUrl,
  ensureLogin,
  favoriteJob,
  formatDate,
  getAccount,
  getActiveRole,
  getJob,
  getMineJobs,
  getPreferences,
  getCounterpartReputation,
  getTeacherApplicationEligibility,
  getTeacherProfile,
  listAppointments,
  listAllJobs,
  listAllParentApplications,
  listConversationMessages,
  listConversations,
  listFavoriteJobs,
  listJobs,
  listNotifications,
  listMyReceivedReviews,
  listParentApplications,
  listTeacherApplications,
  listTeacherReviews,
  logout,
  markAllNotificationsRead,
  markConversationRead,
  markNotificationRead,
  nearbyJobs,
  normalizeJob,
  rejectApplication,
  reopenJob,
  request,
  sendConversationMessage,
  startConversation,
  switchRole,
  updateAppointment,
  updateAccount,
  updateJob,
  updateParentProfile,
  updatePreferences,
  updateTeacherProfile
};
