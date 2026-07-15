import assert from "node:assert/strict";

const baseUrl = process.env.BASE_URL || "http://127.0.0.1:4000";
const covered = new Set();
const expectedEndpoints = [
  "POST /api/v1/auth/wechat-login",
  "POST /api/v1/auth/refresh",
  "POST /api/v1/auth/logout",
  "GET /api/v1/auth/me",
  "POST /api/v1/auth/switch-role",
  "GET /api/v1/profiles/teacher",
  "PATCH /api/v1/profiles/teacher",
  "POST /api/v1/profiles/teacher/certifications",
  "PATCH /api/v1/profiles/parent",
  "GET /api/v1/jobs",
  "GET /api/v1/jobs/nearby",
  "GET /api/v1/jobs/mine",
  "GET /api/v1/jobs/:id",
  "POST /api/v1/jobs",
  "PATCH /api/v1/jobs/:id",
  "POST /api/v1/jobs/:id/favorite",
  "DELETE /api/v1/jobs/:id/favorite",
  "POST /api/v1/jobs/:jobId/applications",
  "GET /api/v1/teacher/applications",
  "GET /api/v1/parent/jobs/:jobId/applications",
  "POST /api/v1/applications/:id/accept",
  "POST /api/v1/applications/:id/reject",
  "GET /api/v1/notifications",
  "POST /api/v1/notifications/read-all",
  "POST /api/v1/notifications/:id/read",
  "GET /api/v1/conversations",
  "POST /api/v1/conversations",
  "GET /api/v1/conversations/:id/messages",
  "POST /api/v1/conversations/:id/messages",
  "POST /api/v1/conversations/:id/read",
  "POST /api/v1/files/upload-url"
];

async function request(path, { token, method = "GET", body, headers = {} } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${method} ${path} -> ${response.status}: ${JSON.stringify(payload)}`);
  return payload;
}

async function mini(endpoint, path, options) {
  covered.add(endpoint);
  return request(path, options);
}

async function expectStatus(status, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method || "GET",
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  assert.equal(response.status, status, `${options.method || "GET"} ${path} should return ${status}`);
}

async function auditTeacher(adminToken, accountId) {
  return request(`/admin-api/v1/teachers/${accountId}/audit`, {
    method: "PATCH",
    token: adminToken,
    body: { status: "APPROVED", note: "小程序全接口自动化认证" }
  });
}

async function auditJob(adminToken, jobId) {
  return request(`/admin-api/v1/jobs/${jobId}/audit`, {
    method: "PATCH",
    token: adminToken,
    body: { status: "APPROVED", note: "小程序全接口自动化审核" }
  });
}

function jobPayload(runId, suffix) {
  return {
    type: "TEACHING_NEED",
    title: `全接口测试${suffix} ${runId}`,
    district: "南山区",
    area: "科技园",
    grade: "高一",
    subject: "数学",
    priceCents: 22000,
    priceUnit: "小时",
    settlement: "周结",
    schedule: "周六 14:00-16:00",
    description: `用于验证小程序全部接口的${suffix}需求。`,
    studentInfo: "高一学生，基础良好",
    address: "深圳市南山区科技园",
    contact: "13800138000",
    latitude: 22.54042,
    longitude: 113.93457,
    capacity: 1
  };
}

const health = await request("/health");
assert.equal(health.status, "ok");

const admin = await request("/admin-api/v1/auth/login", {
  method: "POST",
  body: {
    username: process.env.ADMIN_USERNAME || "admin",
    password: process.env.ADMIN_PASSWORD || "Admin123456!"
  }
});
const runId = Date.now();

const parent = await mini("POST /api/v1/auth/wechat-login", "/api/v1/auth/wechat-login", {
  method: "POST",
  body: { code: `all-api-parent-${runId}`, nickname: "全接口家长", activeRole: "PARENT" }
});
assert.equal(parent.account.activeRole, "PARENT");

const parentMe = await mini("GET /api/v1/auth/me", "/api/v1/auth/me", { token: parent.accessToken });
assert.equal(parentMe.id, parent.account.id);

const oldRefreshToken = parent.refreshToken;
const refreshed = await mini("POST /api/v1/auth/refresh", "/api/v1/auth/refresh", {
  method: "POST",
  body: { refreshToken: oldRefreshToken, activeRole: "PARENT" }
});
parent.accessToken = refreshed.accessToken;
parent.refreshToken = refreshed.refreshToken;
await expectStatus(401, "/api/v1/auth/refresh", {
  method: "POST",
  body: { refreshToken: oldRefreshToken, activeRole: "PARENT" }
});

const parentAsTeacher = await mini("POST /api/v1/auth/switch-role", "/api/v1/auth/switch-role", {
  method: "POST",
  token: parent.accessToken,
  body: { role: "TEACHER" }
});
assert.equal(parentAsTeacher.activeRole, "TEACHER");
const parentAgain = await mini("POST /api/v1/auth/switch-role", "/api/v1/auth/switch-role", {
  method: "POST",
  token: parentAsTeacher.accessToken,
  body: { role: "PARENT" }
});
parent.accessToken = parentAgain.accessToken;

const parentProfile = await mini("PATCH /api/v1/profiles/parent", "/api/v1/profiles/parent", {
  method: "PATCH",
  token: parent.accessToken,
  body: { city: "深圳", district: "南山区", address: "科技园" }
});
assert.equal(parentProfile.district, "南山区");

const teacher = await mini("POST /api/v1/auth/wechat-login", "/api/v1/auth/wechat-login", {
  method: "POST",
  body: { code: `all-api-teacher-${runId}`, nickname: "全接口老师", activeRole: "TEACHER" }
});
const teacherProfile = await mini("GET /api/v1/profiles/teacher", "/api/v1/profiles/teacher", {
  token: teacher.accessToken
});
const updatedTeacher = await mini("PATCH /api/v1/profiles/teacher", "/api/v1/profiles/teacher", {
  method: "PATCH",
  token: teacher.accessToken,
  body: {
    realName: "测试教师",
    bio: "专注高中数学教学",
    school: "华南师范大学",
    major: "数学教育",
    education: "本科",
    teachingYears: 4,
    hourlyRateCents: 22000,
    subjects: ["数学"],
    serviceDistricts: ["南山区"],
    version: teacherProfile.version
  }
});
assert.equal(updatedTeacher.realName, "测试教师");

const upload = await mini("POST /api/v1/files/upload-url", "/api/v1/files/upload-url", {
  method: "POST",
  token: teacher.accessToken,
  body: { fileName: "teacher-proof.pdf", contentType: "application/pdf", size: 1024 }
});
assert.match(upload.uploadUrl, /^http:\/\/127\.0\.0\.1:4003\//);
const uploadResponse = await fetch(upload.uploadUrl, {
  method: "PUT",
  headers: { "content-type": "application/pdf" },
  body: new TextEncoder().encode("%PDF-1.4\n% Tutor Link complete mini API verification\n")
});
assert.equal(uploadResponse.status, 200);
const certification = await mini(
  "POST /api/v1/profiles/teacher/certifications",
  "/api/v1/profiles/teacher/certifications",
  {
    method: "POST",
    token: teacher.accessToken,
    body: { type: "教师资格证明", fileUrl: upload.uploadUrl.split("?")[0] }
  }
);
assert.equal(certification.type, "教师资格证明");
await auditTeacher(admin.accessToken, teacher.account.id);

let acceptedJob = await mini("POST /api/v1/jobs", "/api/v1/jobs", {
  method: "POST",
  token: parent.accessToken,
  body: jobPayload(runId, "录用")
});
acceptedJob = await mini("PATCH /api/v1/jobs/:id", `/api/v1/jobs/${acceptedJob.id}`, {
  method: "PATCH",
  token: parent.accessToken,
  body: { title: `全接口测试录用-已修改 ${runId}`, priceCents: 23000, version: acceptedJob.version }
});
await auditJob(admin.accessToken, acceptedJob.id);

const rejectedJob = await mini("POST /api/v1/jobs", "/api/v1/jobs", {
  method: "POST",
  token: parent.accessToken,
  body: jobPayload(runId, "拒绝")
});
await auditJob(admin.accessToken, rejectedJob.id);

const teacherOffer = await mini("POST /api/v1/jobs", "/api/v1/jobs", {
  method: "POST",
  token: teacher.accessToken,
  body: {
    ...jobPayload(runId, "教师求带"),
    type: "TEACHER_OFFER",
    title: `全接口测试教师求带 ${runId}`
  }
});
await auditJob(admin.accessToken, teacherOffer.id);

const listed = await mini(
  "GET /api/v1/jobs",
  `/api/v1/jobs?type=TEACHING_NEED&district=${encodeURIComponent("南山区")}&keyword=${runId}&limit=10`,
  { token: teacher.accessToken }
);
assert.ok(listed.items.some((item) => item.id === acceptedJob.id));

const nearby = await mini(
  "GET /api/v1/jobs/nearby",
  "/api/v1/jobs/nearby?latitude=22.54042&longitude=113.93457&radiusKm=5&type=TEACHING_NEED",
  { token: teacher.accessToken }
);
assert.ok(nearby.items.some((item) => item.id === acceptedJob.id));

const mine = await mini("GET /api/v1/jobs/mine", "/api/v1/jobs/mine", { token: parent.accessToken });
assert.ok(mine.some((item) => item.id === acceptedJob.id));

const detail = await mini("GET /api/v1/jobs/:id", `/api/v1/jobs/${acceptedJob.id}`, {
  token: teacher.accessToken
});
assert.equal(detail.id, acceptedJob.id);

const favorite = await mini("POST /api/v1/jobs/:id/favorite", `/api/v1/jobs/${acceptedJob.id}/favorite`, {
  method: "POST",
  token: teacher.accessToken
});
assert.equal(favorite.favorite, true);
const favoriteDetail = await mini("GET /api/v1/jobs/:id", `/api/v1/jobs/${acceptedJob.id}`, {
  token: teacher.accessToken
});
assert.equal(favoriteDetail.favorite, true);
const unfavorite = await mini("DELETE /api/v1/jobs/:id/favorite", `/api/v1/jobs/${acceptedJob.id}/favorite`, {
  method: "DELETE",
  token: teacher.accessToken
});
assert.equal(unfavorite.favorite, false);

const idempotencyKey = `all-api-apply-${runId}`;
const [firstApply, duplicateApply] = await Promise.all([
  mini("POST /api/v1/jobs/:jobId/applications", `/api/v1/jobs/${acceptedJob.id}/applications`, {
    method: "POST",
    token: teacher.accessToken,
    headers: { "idempotency-key": idempotencyKey },
    body: { coverLetter: "四年教学经验，可以长期授课。" }
  }),
  mini("POST /api/v1/jobs/:jobId/applications", `/api/v1/jobs/${acceptedJob.id}/applications`, {
    method: "POST",
    token: teacher.accessToken,
    headers: { "idempotency-key": idempotencyKey },
    body: { coverLetter: "重复请求应返回相同结果。" }
  })
]);
assert.equal(firstApply.id, duplicateApply.id);

const rejectApply = await mini("POST /api/v1/jobs/:jobId/applications", `/api/v1/jobs/${rejectedJob.id}/applications`, {
  method: "POST",
  token: teacher.accessToken,
  headers: { "idempotency-key": `all-api-reject-${runId}` },
  body: { coverLetter: "用于验证拒绝流程。" }
});

const acceptedApplications = await mini(
  "GET /api/v1/parent/jobs/:jobId/applications",
  `/api/v1/parent/jobs/${acceptedJob.id}/applications`,
  { token: parent.accessToken }
);
assert.equal(acceptedApplications.length, 1);
const accepted = await mini(
  "POST /api/v1/applications/:id/accept",
  `/api/v1/applications/${acceptedApplications[0].id}/accept`,
  { method: "POST", token: parent.accessToken, body: { note: "全接口测试录用" } }
);
assert.equal(accepted.status, "ACCEPTED");

const rejectedApplications = await mini(
  "GET /api/v1/parent/jobs/:jobId/applications",
  `/api/v1/parent/jobs/${rejectedJob.id}/applications`,
  { token: parent.accessToken }
);
assert.equal(rejectedApplications[0].id, rejectApply.id);
const rejected = await mini(
  "POST /api/v1/applications/:id/reject",
  `/api/v1/applications/${rejectApply.id}/reject`,
  { method: "POST", token: parent.accessToken, body: { note: "全接口测试拒绝" } }
);
assert.equal(rejected.status, "REJECTED");

const teacherApplications = await mini(
  "GET /api/v1/teacher/applications",
  "/api/v1/teacher/applications",
  { token: teacher.accessToken }
);
assert.ok(teacherApplications.some((item) => item.id === firstApply.id && item.status === "ACCEPTED"));
assert.ok(teacherApplications.some((item) => item.id === rejectApply.id && item.status === "REJECTED"));

const conversation = await mini("POST /api/v1/conversations", "/api/v1/conversations", {
  method: "POST",
  token: parent.accessToken,
  body: { memberId: teacher.account.id, jobId: acceptedJob.id }
});
const sameConversation = await mini("POST /api/v1/conversations", "/api/v1/conversations", {
  method: "POST",
  token: parent.accessToken,
  body: { memberId: teacher.account.id, jobId: acceptedJob.id }
});
assert.equal(sameConversation.id, conversation.id);

const clientMessageId = crypto.randomUUID();
const firstMessage = await mini(
  "POST /api/v1/conversations/:id/messages",
  `/api/v1/conversations/${conversation.id}/messages`,
  {
    method: "POST",
    token: parent.accessToken,
    body: { clientMessageId, content: "您好，想沟通一下课程安排。" }
  }
);
const duplicateMessage = await mini(
  "POST /api/v1/conversations/:id/messages",
  `/api/v1/conversations/${conversation.id}/messages`,
  {
    method: "POST",
    token: parent.accessToken,
    body: { clientMessageId, content: "重复消息不会生成第二条。" }
  }
);
assert.equal(firstMessage.id, duplicateMessage.id);

const messages = await mini(
  "GET /api/v1/conversations/:id/messages",
  `/api/v1/conversations/${conversation.id}/messages`,
  { token: teacher.accessToken }
);
assert.ok(messages.items.some((item) => item.id === firstMessage.id));
const readConversation = await mini(
  "POST /api/v1/conversations/:id/read",
  `/api/v1/conversations/${conversation.id}/read`,
  { method: "POST", token: teacher.accessToken, body: {} }
);
assert.equal(readConversation.success, true);
const conversations = await mini("GET /api/v1/conversations", "/api/v1/conversations", {
  token: teacher.accessToken
});
assert.equal(conversations.find((item) => item.id === conversation.id)?.unreadCount, 0);

let notifications = [];
for (let attempt = 0; attempt < 30; attempt += 1) {
  notifications = await mini("GET /api/v1/notifications", "/api/v1/notifications", {
    token: teacher.accessToken
  });
  if (notifications.some((item) => item.readAt === null)) break;
  await new Promise((resolve) => setTimeout(resolve, 100));
}
assert.ok(notifications.length > 0);
const unread = notifications.find((item) => item.readAt === null) || notifications[0];
const readOne = await mini("POST /api/v1/notifications/:id/read", `/api/v1/notifications/${unread.id}/read`, {
  method: "POST",
  token: teacher.accessToken
});
assert.equal(readOne.success, true);
const readAll = await mini("POST /api/v1/notifications/read-all", "/api/v1/notifications/read-all", {
  method: "POST",
  token: teacher.accessToken
});
assert.ok(readAll.updated >= 0);

const logout = await mini("POST /api/v1/auth/logout", "/api/v1/auth/logout", {
  method: "POST",
  token: parent.accessToken,
  body: { refreshToken: parent.refreshToken, activeRole: "PARENT" }
});
assert.equal(logout.success, true);
await expectStatus(401, "/api/v1/auth/refresh", {
  method: "POST",
  body: { refreshToken: parent.refreshToken, activeRole: "PARENT" }
});

assert.deepEqual([...covered].sort(), [...expectedEndpoints].sort());
console.log(`Mini API verification passed: ${covered.size}/${expectedEndpoints.length} endpoints covered.`);
