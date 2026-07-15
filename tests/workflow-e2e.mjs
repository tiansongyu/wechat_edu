import assert from "node:assert/strict";

const baseUrl = process.env.BASE_URL || "http://127.0.0.1:4000";
const runId = Date.now();
const covered = new Set();

async function raw(path, { token, method = "GET", body, headers = {} } = {}) {
  // Exercise the public gateway without overflowing its intentional 30 r/s
  // per-client limiter during this highly sequential integration run.
  await new Promise((resolve) => setTimeout(resolve, 40));
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers
    },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

async function request(endpoint, path, options = {}) {
  covered.add(endpoint);
  const { response, payload } = await raw(path, options);
  if (!response.ok) {
    throw new Error(`${options.method || "GET"} ${path} -> ${response.status}: ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function expectStatus(status, path, options = {}) {
  const result = await raw(path, options);
  assert.equal(
    result.response.status,
    status,
    `${options.method || "GET"} ${path}: ${JSON.stringify(result.payload)}`
  );
  return result.payload;
}

function jobPayload(suffix, overrides = {}) {
  return {
    type: "TEACHING_NEED",
    title: `工作流回归-${suffix}-${runId}`,
    district: "南山区",
    area: "科技园",
    grade: "高一",
    subject: "数学",
    priceCents: 22000,
    priceUnit: "小时",
    settlement: "周结",
    schedule: "周六 14:00-16:00",
    description: `数据库工作流自动化验证：${suffix}`,
    studentInfo: "高一学生",
    address: "深圳市南山区科技园",
    contact: "13800138000",
    latitude: 22.54042,
    longitude: 113.93457,
    capacity: 1,
    ...overrides
  };
}

async function adminLogin() {
  return request("POST /admin-api/v1/auth/login", "/admin-api/v1/auth/login", {
    method: "POST",
    body: {
      username: process.env.ADMIN_USERNAME || "admin",
      password: process.env.ADMIN_PASSWORD || "Admin123456!"
    }
  });
}

async function wechatLogin(name, activeRole) {
  const deviceId = `workflow-${name}-${runId}`;
  const session = await request("POST /api/v1/auth/wechat-login", "/api/v1/auth/wechat-login", {
    method: "POST",
    body: { code: `${name}-code-1-${runId}`, deviceId, nickname: name, activeRole }
  });
  const sameAccount = await request("POST /api/v1/auth/wechat-login", "/api/v1/auth/wechat-login", {
    method: "POST",
    body: { code: `${name}-code-2-${runId}`, deviceId, nickname: name, activeRole }
  });
  assert.equal(sameAccount.account.id, session.account.id, "同一设备的模拟微信登录必须复用数据库账号");
  return { ...sameAccount, deviceId };
}

async function submitAndApproveTeacher(adminToken, session, displayName) {
  const profile = await request("GET /api/v1/profiles/teacher", "/api/v1/profiles/teacher", {
    token: session.accessToken
  });
  const updated = await request("PATCH /api/v1/profiles/teacher", "/api/v1/profiles/teacher", {
    method: "PATCH",
    token: session.accessToken,
    body: {
      realName: displayName,
      bio: "自动化测试教师资料",
      school: "华南师范大学",
      major: "数学教育",
      education: "本科",
      teachingYears: 4,
      hourlyRateCents: 22000,
      subjects: ["数学"],
      serviceDistricts: ["南山区"],
      version: profile.version
    }
  });
  assert.equal(updated.auditStatus, "PENDING");
  assert.ok(updated.submittedAt);
  const approved = await request(
    "PATCH /admin-api/v1/teachers/:id/audit",
    `/admin-api/v1/teachers/${session.account.id}/audit`,
    {
      method: "PATCH",
      token: adminToken,
      body: { status: "APPROVED", note: "工作流回归认证通过", version: updated.version }
    }
  );
  assert.equal(approved.auditStatus, "APPROVED");
  await expectStatus(409, `/admin-api/v1/teachers/${session.account.id}/audit`, {
    method: "PATCH",
    token: adminToken,
    body: { status: "REJECTED", note: "过期的重复操作", version: updated.version }
  });
}

async function createAndApproveJob(adminToken, ownerToken, suffix, overrides) {
  const job = await request("POST /api/v1/jobs", "/api/v1/jobs", {
    method: "POST",
    token: ownerToken,
    body: jobPayload(suffix, overrides)
  });
  assert.equal(job.status, "PENDING");
  const approved = await request("PATCH /admin-api/v1/jobs/:id/audit", `/admin-api/v1/jobs/${job.id}/audit`, {
    method: "PATCH",
    token: adminToken,
    body: { status: "APPROVED", note: "工作流回归发布通过", version: job.version }
  });
  assert.equal(approved.status, "PUBLISHED");
  await expectStatus(409, `/admin-api/v1/jobs/${job.id}/audit`, {
    method: "PATCH",
    token: adminToken,
    body: { status: "REJECTED", note: "过期的重复操作", version: job.version }
  });
  return approved;
}

async function apply(token, jobId, suffix) {
  return request("POST /api/v1/jobs/:jobId/applications", `/api/v1/jobs/${jobId}/applications`, {
    method: "POST",
    token,
    headers: { "idempotency-key": `workflow-${suffix}-${runId}-${crypto.randomUUID()}` },
    body: { coverLetter: `工作流自动化报名：${suffix}` }
  });
}

const health = await request("GET /health", "/health");
assert.equal(health.status, "ok");

let admin = await adminLogin();
assert.equal(admin.account.activeRole, "ADMIN");
const refreshedAdmin = await request("POST /admin-api/v1/auth/refresh", "/admin-api/v1/auth/refresh", {
  method: "POST",
  body: { refreshToken: admin.refreshToken, activeRole: "ADMIN" }
});
admin = { ...admin, ...refreshedAdmin };

const parent = await wechatLogin("工作流家长", "PARENT");
const teacherA = await wechatLogin("工作流老师甲", "TEACHER");
const teacherB = await wechatLogin("工作流老师乙", "TEACHER");

const me = await request("GET /api/v1/auth/me", "/api/v1/auth/me", { token: parent.accessToken });
assert.equal(me.id, parent.account.id);
const parentProfile = await request("PATCH /api/v1/profiles/parent", "/api/v1/profiles/parent", {
  method: "PATCH",
  token: parent.accessToken,
  body: { city: "深圳", district: "南山区", address: "科技园" }
});
assert.equal(parentProfile.district, "南山区");

const preferences = await request("GET /api/v1/preferences", "/api/v1/preferences", { token: parent.accessToken });
const updatedPreferences = await request("PATCH /api/v1/preferences", "/api/v1/preferences", {
  method: "PATCH",
  token: parent.accessToken,
  body: { jobNotice: false, chatNotice: true, privacyMode: true }
});
assert.equal(updatedPreferences.privacyMode, true);
const persistedPreferences = await request("GET /api/v1/preferences", "/api/v1/preferences", {
  token: parent.accessToken
});
assert.equal(persistedPreferences.jobNotice, false);

await expectStatus(403, "/api/v1/teacher/applications", { token: parent.accessToken });
await expectStatus(400, "/api/v1/jobs/not-a-uuid", { token: parent.accessToken });

await submitAndApproveTeacher(admin.accessToken, teacherA, "测试老师甲");
await submitAndApproveTeacher(admin.accessToken, teacherB, "测试老师乙");

const upload = await request("POST /api/v1/files/upload-url", "/api/v1/files/upload-url", {
  method: "POST",
  token: teacherA.accessToken,
  body: { fileName: "workflow-proof.pdf", contentType: "application/pdf", size: 64 }
});
assert.match(upload.objectKey, new RegExp(`^private/${teacherA.account.id}/`));
assert.equal(upload.requiredHeaders["Content-Type"], "application/pdf");
const uploadResult = await fetch(upload.uploadUrl, {
  method: "PUT",
  headers: { "content-type": "application/pdf" },
  body: new TextEncoder().encode("%PDF-1.4\n% workflow verification\n")
});
assert.equal(uploadResult.status, 200);
const certification = await request(
  "POST /api/v1/profiles/teacher/certifications",
  "/api/v1/profiles/teacher/certifications",
  {
    method: "POST",
    token: teacherA.accessToken,
    body: { type: "教师资格证明", objectKey: upload.objectKey }
  }
);
assert.equal(certification.objectKey, upload.objectKey);
const missingUpload = await request("POST /api/v1/files/upload-url", "/api/v1/files/upload-url", {
  method: "POST",
  token: teacherA.accessToken,
  body: { fileName: "missing-proof.pdf", contentType: "application/pdf", size: 64 }
});
await expectStatus(400, "/api/v1/profiles/teacher/certifications", {
  method: "POST",
  token: teacherA.accessToken,
  body: { type: "不存在的认证材料", objectKey: missingUpload.objectKey }
});
const teacherAfterCertification = await request(
  "GET /api/v1/profiles/teacher",
  "/api/v1/profiles/teacher",
  { token: teacherA.accessToken }
);
await request(
  "PATCH /admin-api/v1/teachers/:id/audit",
  `/admin-api/v1/teachers/${teacherA.account.id}/audit`,
  {
    method: "PATCH",
    token: admin.accessToken,
    body: {
      status: "APPROVED",
      note: "证件补充后认证通过",
      version: teacherAfterCertification.version
    }
  }
);

await expectStatus(403, "/api/v1/jobs", {
  method: "POST",
  token: parent.accessToken,
  body: jobPayload("越权教师发布", { type: "TEACHER_OFFER" })
});
await expectStatus(400, "/api/v1/jobs", {
  method: "POST",
  token: parent.accessToken,
  body: jobPayload("空白字段", { title: "   " })
});
await expectStatus(400, "/api/v1/jobs", {
  method: "POST",
  token: parent.accessToken,
  body: jobPayload("非法联系方式", { contact: "<script>alert(1)</script>" })
});
const onlineJob = await request("POST /api/v1/jobs", "/api/v1/jobs", {
  method: "POST",
  token: parent.accessToken,
  body: jobPayload("线上坐标清理", {
    district: "线上",
    address: "不应保留的旧地址",
    latitude: 22.54042,
    longitude: 113.93457
  })
});
assert.equal(onlineJob.address, null);
assert.equal(onlineJob.latitude, null);
assert.equal(onlineJob.longitude, null);

const offer = await createAndApproveJob(admin.accessToken, teacherA.accessToken, "教师求带", {
  type: "TEACHER_OFFER",
  title: `工作流教师求带-${runId}`
});
assert.equal(offer.type, "TEACHER_OFFER");

const capacityJob = await request("POST /api/v1/jobs", "/api/v1/jobs", {
  method: "POST",
  token: parent.accessToken,
  body: jobPayload("满额自动关闭")
});
const updatedJob = await request("PATCH /api/v1/jobs/:id", `/api/v1/jobs/${capacityJob.id}`, {
  method: "PATCH",
  token: parent.accessToken,
  body: {
    title: `工作流满额自动关闭-已修改-${runId}`,
    latitude: 22.541,
    longitude: 113.935,
    version: capacityJob.version
  }
});
assert.equal(updatedJob.status, "PENDING");
await request(
  "PATCH /admin-api/v1/jobs/:id/audit",
  `/admin-api/v1/jobs/${capacityJob.id}/audit`,
  {
    method: "PATCH",
    token: admin.accessToken,
    body: { status: "APPROVED", note: "修改后重新通过", version: updatedJob.version }
  }
);

const jobs = await request("GET /api/v1/jobs", `/api/v1/jobs?keyword=${runId}&limit=50`, {
  token: teacherA.accessToken
});
assert.ok(jobs.items.some((item) => item.id === capacityJob.id));
const nearby = await request(
  "GET /api/v1/jobs/nearby",
  "/api/v1/jobs/nearby?latitude=22.541&longitude=113.935&radiusKm=2&type=TEACHING_NEED",
  { token: teacherA.accessToken }
);
assert.ok(nearby.items.some((item) => item.id === capacityJob.id));
const nearbyFiltered = await request(
  "GET /api/v1/jobs/nearby",
  "/api/v1/jobs/nearby?latitude=22.541&longitude=113.935&radiusKm=2&type=TEACHING_NEED&subject=英语&limit=5",
  { token: teacherA.accessToken }
);
assert.ok(!nearbyFiltered.items.some((item) => item.id === capacityJob.id), "附近接口必须应用 subject 过滤条件");
const mine = await request("GET /api/v1/jobs/mine", "/api/v1/jobs/mine", { token: parent.accessToken });
assert.ok(mine.some((item) => item.id === capacityJob.id));

await request("POST /api/v1/jobs/:id/favorite", `/api/v1/jobs/${capacityJob.id}/favorite`, {
  method: "POST",
  token: teacherA.accessToken
});
const favoriteJobs = await request("GET /api/v1/jobs/favorites", "/api/v1/jobs/favorites", {
  token: teacherA.accessToken
});
assert.ok(favoriteJobs.some((item) => item.id === capacityJob.id && item.favorite));
const detail = await request("GET /api/v1/jobs/:id", `/api/v1/jobs/${capacityJob.id}`, {
  token: teacherA.accessToken
});
assert.equal(detail.favorite, true);
assert.equal(detail.address, null, "隐私模式下，未录用老师不应看到详细地址");
assert.equal(Number(detail.latitude), 22.54, "隐私模式下，未录用老师只能看到降精度坐标");
assert.equal(Number(detail.longitude), 113.94, "隐私模式下，未录用老师只能看到降精度坐标");
await request("DELETE /api/v1/jobs/:id/favorite", `/api/v1/jobs/${capacityJob.id}/favorite`, {
  method: "DELETE",
  token: teacherA.accessToken
});

const capacityApplyA = await apply(teacherA.accessToken, capacityJob.id, "capacity-a");
const capacityApplyB = await apply(teacherB.accessToken, capacityJob.id, "capacity-b");
const teacherBBeforeDecision = await request(
  "GET /api/v1/teacher/applications",
  "/api/v1/teacher/applications",
  { token: teacherB.accessToken }
);
const teacherBPending = teacherBBeforeDecision.find((item) => item.id === capacityApplyB.id);
assert.equal(teacherBPending.job.address, null, "报名列表也必须遵守位置隐私规则");
const perJobApplications = await request(
  "GET /api/v1/parent/jobs/:jobId/applications",
  `/api/v1/parent/jobs/${capacityJob.id}/applications`,
  { token: parent.accessToken }
);
assert.equal(perJobApplications.length, 2);
const accepted = await request("POST /api/v1/applications/:id/accept", `/api/v1/applications/${capacityApplyA.id}/accept`, {
  method: "POST",
  token: parent.accessToken,
  body: { note: "录用老师甲" }
});
assert.equal(accepted.status, "ACCEPTED");
const acceptedDetail = await request("GET /api/v1/jobs/:id", `/api/v1/jobs/${capacityJob.id}`, {
  token: teacherA.accessToken
});
assert.equal(acceptedDetail.address, "深圳市南山区科技园");
assert.equal(Number(acceptedDetail.latitude), 22.541);
const afterCapacity = await request(
  "GET /api/v1/parent/jobs/:jobId/applications",
  `/api/v1/parent/jobs/${capacityJob.id}/applications`,
  { token: parent.accessToken }
);
const autoRejected = afterCapacity.find((item) => item.id === capacityApplyB.id);
assert.equal(autoRejected.status, "REJECTED");
assert.match(autoRejected.statusNote, /名额已满/);

let appointmentsA = await request("GET /api/v1/appointments", "/api/v1/appointments", {
  token: teacherA.accessToken
});
let appointmentA = appointmentsA.find((item) => item.applicationId === capacityApplyA.id);
assert.ok(appointmentA);
appointmentA = await request("POST /api/v1/appointments/:id/confirm", `/api/v1/appointments/${appointmentA.id}/confirm`, {
  method: "POST",
  token: teacherA.accessToken,
  body: {}
});
assert.equal(appointmentA.status, "CONFIRMED");
appointmentA = await request("POST /api/v1/appointments/:id/complete", `/api/v1/appointments/${appointmentA.id}/complete`, {
  method: "POST",
  token: parent.accessToken,
  body: { reason: "课程已经完成" }
});
assert.equal(appointmentA.status, "COMPLETED");

const cancelJob = await createAndApproveJob(admin.accessToken, parent.accessToken, "取消后重报", { capacity: 2 });
const cancelledApplication = await apply(teacherA.accessToken, cancelJob.id, "cancel-reapply");
await expectStatus(400, `/api/v1/applications/${cancelledApplication.id}/cancel`, {
  method: "POST",
  token: teacherA.accessToken,
  body: { note: "   " }
});
const cancelled = await request("POST /api/v1/applications/:id/cancel", `/api/v1/applications/${cancelledApplication.id}/cancel`, {
  method: "POST",
  token: teacherA.accessToken,
  body: { note: "时间冲突，先取消" }
});
assert.equal(cancelled.status, "CANCELLED");
assert.match(cancelled.statusNote, /时间冲突/);
const reapplied = await apply(teacherA.accessToken, cancelJob.id, "reapply");
assert.equal(reapplied.id, cancelledApplication.id);
const rejected = await request("POST /api/v1/applications/:id/reject", `/api/v1/applications/${reapplied.id}/reject`, {
  method: "POST",
  token: parent.accessToken,
  body: { note: "时间安排不匹配" }
});
assert.equal(rejected.status, "REJECTED");
assert.match(rejected.statusNote, /时间安排/);

const closeJob = await createAndApproveJob(admin.accessToken, parent.accessToken, "关闭与重开");
const closeApplication = await apply(teacherA.accessToken, closeJob.id, "close");
const closed = await request("POST /api/v1/jobs/:id/close", `/api/v1/jobs/${closeJob.id}/close`, {
  method: "POST",
  token: parent.accessToken
});
assert.equal(closed.status, "CLOSED");
const closedApplications = await request(
  "GET /api/v1/parent/jobs/:jobId/applications",
  `/api/v1/parent/jobs/${closeJob.id}/applications`,
  { token: parent.accessToken }
);
assert.equal(closedApplications.find((item) => item.id === closeApplication.id).status, "REJECTED");
const reopened = await request("POST /api/v1/jobs/:id/reopen", `/api/v1/jobs/${closeJob.id}/reopen`, {
  method: "POST",
  token: parent.accessToken
});
assert.equal(reopened.status, "PENDING");

const adminApplicationJob = await createAndApproveJob(admin.accessToken, parent.accessToken, "管理员拒绝报名");
const adminApplication = await apply(teacherB.accessToken, adminApplicationJob.id, "admin-reject");
await expectStatus(400, `/admin-api/v1/applications/${adminApplication.id}/status`, {
  method: "PATCH",
  token: admin.accessToken,
  body: { status: "REJECTED", version: 1 }
});
const adminRejected = await request(
  "PATCH /admin-api/v1/applications/:id/status",
  `/admin-api/v1/applications/${adminApplication.id}/status`,
  {
    method: "PATCH",
    token: admin.accessToken,
    body: { status: "REJECTED", note: "管理员核实后拒绝", version: 1 }
  }
);
assert.equal(adminRejected.status, "REJECTED");
await expectStatus(409, `/admin-api/v1/applications/${adminApplication.id}/status`, {
  method: "PATCH",
  token: admin.accessToken,
  body: { status: "CANCELLED", note: "重复过期操作", version: 1 }
});

const cancelAppointmentJob = await createAndApproveJob(admin.accessToken, parent.accessToken, "取消预约");
const cancelAppointmentApplication = await apply(teacherB.accessToken, cancelAppointmentJob.id, "appointment-cancel");
await request("POST /api/v1/applications/:id/accept", `/api/v1/applications/${cancelAppointmentApplication.id}/accept`, {
  method: "POST",
  token: parent.accessToken,
  body: { note: "创建待取消预约" }
});
const teacherBAppointments = await request("GET /api/v1/appointments", "/api/v1/appointments", {
  token: teacherB.accessToken
});
const cancelAppointment = teacherBAppointments.find(
  (item) => item.applicationId === cancelAppointmentApplication.id
);
await expectStatus(400, `/api/v1/appointments/${cancelAppointment.id}/cancel`, {
  method: "POST",
  token: teacherB.accessToken,
  body: {}
});
const cancelledAppointment = await request(
  "POST /api/v1/appointments/:id/cancel",
  `/api/v1/appointments/${cancelAppointment.id}/cancel`,
  { method: "POST", token: teacherB.accessToken, body: { reason: "临时身体不适" } }
);
assert.equal(cancelledAppointment.status, "CANCELLED");

const adminAppointmentJob = await createAndApproveJob(admin.accessToken, parent.accessToken, "管理员预约处理");
const adminAppointmentApplication = await apply(teacherA.accessToken, adminAppointmentJob.id, "admin-appointment");
await request("POST /api/v1/applications/:id/accept", `/api/v1/applications/${adminAppointmentApplication.id}/accept`, {
  method: "POST",
  token: parent.accessToken,
  body: { note: "创建管理员处理预约" }
});
const adminAppointments = await request("GET /admin-api/v1/appointments", "/admin-api/v1/appointments?pageSize=100", {
  token: admin.accessToken
});
const adminAppointment = adminAppointments.items.find(
  (item) => item.applicationId === adminAppointmentApplication.id
);
const adminConfirmed = await request(
  "PATCH /admin-api/v1/appointments/:id/status",
  `/admin-api/v1/appointments/${adminAppointment.id}/status`,
  {
    method: "PATCH",
    token: admin.accessToken,
    body: { status: "CONFIRMED", note: "管理员确认", version: adminAppointment.version }
  }
);
assert.equal(adminConfirmed.status, "CONFIRMED");

const disputeJob = await createAndApproveJob(admin.accessToken, parent.accessToken, "预约争议");
const disputeApplication = await apply(teacherA.accessToken, disputeJob.id, "appointment-dispute");
await request("POST /api/v1/applications/:id/accept", `/api/v1/applications/${disputeApplication.id}/accept`, {
  method: "POST",
  token: parent.accessToken,
  body: { note: "创建争议预约" }
});
const disputeAppointments = await request("GET /api/v1/appointments", "/api/v1/appointments", {
  token: parent.accessToken
});
const disputedTarget = disputeAppointments.find((item) => item.applicationId === disputeApplication.id);
const disputed = await request("POST /api/v1/appointments/:id/dispute", `/api/v1/appointments/${disputedTarget.id}/dispute`, {
  method: "POST",
  token: parent.accessToken,
  body: { reason: "实际授课情况存在分歧" }
});
assert.equal(disputed.status, "DISPUTED");
const acceptedApplications = await request(
  "GET /admin-api/v1/applications",
  "/admin-api/v1/applications?status=ACCEPTED&pageSize=100",
  { token: admin.accessToken }
);
const disputedApplication = acceptedApplications.items.find((item) => item.id === disputeApplication.id);
assert.ok(disputedApplication);
const cancelledDisputedApplication = await request(
  "PATCH /admin-api/v1/applications/:id/status",
  `/admin-api/v1/applications/${disputedApplication.id}/status`,
  {
    method: "PATCH",
    token: admin.accessToken,
    body: {
      status: "CANCELLED",
      note: "争议协商后终止合作",
      version: disputedApplication.version
    }
  }
);
assert.equal(cancelledDisputedApplication.status, "CANCELLED");
const cancelledDisputedAppointments = await request(
  "GET /admin-api/v1/appointments",
  "/admin-api/v1/appointments?status=CANCELLED&pageSize=100",
  { token: admin.accessToken }
);
assert.equal(
  cancelledDisputedAppointments.items.find((item) => item.id === disputedTarget.id)?.status,
  "CANCELLED"
);

const parentApplications = await request(
  "GET /api/v1/parent/applications",
  "/api/v1/parent/applications",
  { token: parent.accessToken }
);
assert.ok(parentApplications.some((item) => item.id === capacityApplyA.id));
const teacherApplications = await request(
  "GET /api/v1/teacher/applications",
  "/api/v1/teacher/applications",
  { token: teacherA.accessToken }
);
assert.ok(teacherApplications.some((item) => item.id === capacityApplyA.id));

await expectStatus(400, "/api/v1/conversations", {
  method: "POST",
  token: parent.accessToken,
  body: { memberId: teacherA.account.id }
});
await expectStatus(403, "/api/v1/conversations", {
  method: "POST",
  token: parent.accessToken,
  body: { memberId: teacherB.account.id, jobId: capacityJob.id }
});
const conversation = await request("POST /api/v1/conversations", "/api/v1/conversations", {
  method: "POST",
  token: parent.accessToken,
  body: { memberId: teacherA.account.id, jobId: capacityJob.id }
});
const sameConversation = await request("POST /api/v1/conversations", "/api/v1/conversations", {
  method: "POST",
  token: parent.accessToken,
  body: { memberId: teacherA.account.id, jobId: capacityJob.id }
});
assert.equal(sameConversation.id, conversation.id);
await request("PATCH /api/v1/preferences", "/api/v1/preferences", {
  method: "PATCH",
  token: teacherA.accessToken,
  body: { chatNotice: false }
});
await expectStatus(400, `/api/v1/conversations/${conversation.id}/messages`, {
  method: "POST",
  token: parent.accessToken,
  body: { clientMessageId: crypto.randomUUID(), content: "   " }
});
const clientMessageId = crypto.randomUUID();
const message = await request(
  "POST /api/v1/conversations/:id/messages",
  `/api/v1/conversations/${conversation.id}/messages`,
  {
    method: "POST",
    token: parent.accessToken,
    body: { clientMessageId, content: "工作流回归消息" }
  }
);
const duplicateMessage = await request(
  "POST /api/v1/conversations/:id/messages",
  `/api/v1/conversations/${conversation.id}/messages`,
  {
    method: "POST",
    token: parent.accessToken,
    body: { clientMessageId, content: "该重复消息不应新增" }
  }
);
assert.equal(duplicateMessage.id, message.id);
const mutedConversations = await request("GET /api/v1/conversations", "/api/v1/conversations", {
  token: teacherA.accessToken
});
assert.equal(mutedConversations.find((item) => item.id === conversation.id).unreadCount, 0);
await request("PATCH /api/v1/preferences", "/api/v1/preferences", {
  method: "PATCH",
  token: teacherA.accessToken,
  body: { chatNotice: true }
});
const unmutedConversations = await request("GET /api/v1/conversations", "/api/v1/conversations", {
  token: teacherA.accessToken
});
assert.ok(unmutedConversations.find((item) => item.id === conversation.id).unreadCount >= 1);
const messages = await request(
  "GET /api/v1/conversations/:id/messages",
  `/api/v1/conversations/${conversation.id}/messages`,
  { token: teacherA.accessToken }
);
assert.ok(messages.items.some((item) => item.id === message.id));
const readConversation = await request(
  "POST /api/v1/conversations/:id/read",
  `/api/v1/conversations/${conversation.id}/read`,
  { method: "POST", token: teacherA.accessToken, body: {} }
);
assert.equal(readConversation.success, true);
const conversations = await request("GET /api/v1/conversations", "/api/v1/conversations", {
  token: teacherA.accessToken
});
assert.ok(conversations.some((item) => item.id === conversation.id));

let notifications = [];
for (let attempt = 0; attempt < 30; attempt += 1) {
  notifications = await request("GET /api/v1/notifications", "/api/v1/notifications", {
    token: teacherA.accessToken
  });
  if (notifications.length) break;
  await new Promise((resolve) => setTimeout(resolve, 100));
}
assert.ok(notifications.length > 0);
const readOne = await request(
  "POST /api/v1/notifications/:id/read",
  `/api/v1/notifications/${notifications[0].id}/read`,
  { method: "POST", token: teacherA.accessToken }
);
assert.equal(readOne.success, true);
const readAll = await request("POST /api/v1/notifications/read-all", "/api/v1/notifications/read-all", {
  method: "POST",
  token: teacherA.accessToken
});
assert.ok(readAll.updated >= 0);

const dashboard = await request("GET /admin-api/v1/dashboard", "/admin-api/v1/dashboard", {
  token: admin.accessToken
});
assert.ok(dashboard.metrics.users > 0);
const users = await request(
  "GET /admin-api/v1/users",
  `/admin-api/v1/users?keyword=${encodeURIComponent("工作流老师乙")}&pageSize=100`,
  { token: admin.accessToken }
);
assert.ok(users.items.some((item) => item.id === teacherB.account.id));
await request("GET /admin-api/v1/teachers/audits", "/admin-api/v1/teachers/audits?pageSize=100", {
  token: admin.accessToken
});
await request("GET /admin-api/v1/jobs/audits", "/admin-api/v1/jobs/audits?pageSize=100", {
  token: admin.accessToken
});
const adminApplications = await request(
  "GET /admin-api/v1/applications",
  "/admin-api/v1/applications?pageSize=100",
  { token: admin.accessToken }
);
assert.ok(adminApplications.items.some((item) => item.id === adminApplication.id));
const auditLogs = await request("GET /admin-api/v1/audit-logs", "/admin-api/v1/audit-logs?pageSize=100", {
  token: admin.accessToken
});
assert.ok(auditLogs.items.length > 0);

await request("PATCH /admin-api/v1/users/:id/status", `/admin-api/v1/users/${teacherB.account.id}/status`, {
  method: "PATCH",
  token: admin.accessToken,
  body: { status: "SUSPENDED", note: "验证旧令牌即时失效" }
});
await expectStatus(401, "/api/v1/auth/me", { token: teacherB.accessToken });
await request("PATCH /admin-api/v1/users/:id/status", `/admin-api/v1/users/${teacherB.account.id}/status`, {
  method: "PATCH",
  token: admin.accessToken,
  body: { status: "ACTIVE", note: "自动化验证完成后恢复" }
});

const refreshBeforeLogout = parent.refreshToken;
const refreshedParent = await request("POST /api/v1/auth/refresh", "/api/v1/auth/refresh", {
  method: "POST",
  body: { refreshToken: refreshBeforeLogout, activeRole: "PARENT" }
});
await expectStatus(401, "/api/v1/auth/refresh", {
  method: "POST",
  body: { refreshToken: refreshBeforeLogout, activeRole: "PARENT" }
});
const switched = await request("POST /api/v1/auth/switch-role", "/api/v1/auth/switch-role", {
  method: "POST",
  token: refreshedParent.accessToken,
  body: { role: "TEACHER" }
});
assert.equal(switched.activeRole, "TEACHER");
const switchedBack = await request("POST /api/v1/auth/switch-role", "/api/v1/auth/switch-role", {
  method: "POST",
  token: switched.accessToken,
  body: { role: "PARENT" }
});
const logout = await request("POST /api/v1/auth/logout", "/api/v1/auth/logout", {
  method: "POST",
  token: switchedBack.accessToken,
  body: { refreshToken: refreshedParent.refreshToken }
});
assert.equal(logout.success, true);
await expectStatus(401, "/api/v1/auth/refresh", {
  method: "POST",
  body: { refreshToken: refreshedParent.refreshToken, activeRole: "PARENT" }
});

console.log(`Workflow E2E passed: ${covered.size} unique endpoint contracts, database state machines and admin overrides.`);
