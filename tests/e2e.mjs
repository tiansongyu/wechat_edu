import assert from "node:assert/strict";

const baseUrl = process.env.BASE_URL || "http://127.0.0.1:8080";

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

const health = await request("/health");
assert.equal(health.status, "ok");

const admin = await request("/admin-api/v1/auth/login", {
  method: "POST",
  body: { username: process.env.ADMIN_USERNAME || "admin", password: process.env.ADMIN_PASSWORD || "Admin123456!" }
});
assert.ok(admin.accessToken);

const runId = Date.now();
const parent = await request("/api/v1/auth/wechat-login", {
  method: "POST",
  body: { code: `e2e-parent-${runId}`, nickname: "端到端家长", activeRole: "PARENT" }
});
const teacher = await request("/api/v1/auth/wechat-login", {
  method: "POST",
  body: { code: `e2e-teacher-${runId}`, nickname: "端到端老师", activeRole: "TEACHER" }
});

const upload = await request("/api/v1/files/upload-url", {
  method: "POST",
  token: teacher.accessToken,
  body: { fileName: "teacher-proof.pdf", contentType: "application/pdf", size: 1024 }
});
assert.match(upload.uploadUrl, /^http:\/\/127\.0\.0\.1:9000\//);
assert.equal(upload.expiresIn, 600);
const uploadResponse = await fetch(upload.uploadUrl, {
  method: "PUT",
  headers: { "content-type": "application/pdf" },
  body: new TextEncoder().encode("Tutor Link E2E teacher certification")
});
assert.equal(uploadResponse.status, 200);
const certification = await request("/api/v1/profiles/teacher/certifications", {
  method: "POST",
  token: teacher.accessToken,
  body: { type: "教师资格证明", fileUrl: upload.uploadUrl.split("?")[0] }
});
assert.equal(certification.type, "教师资格证明");

const teacherProfile = await request("/api/v1/profiles/teacher", { token: teacher.accessToken });
await request("/api/v1/profiles/teacher", {
  method: "PATCH",
  token: teacher.accessToken,
  body: {
    realName: "测试老师",
    school: "华南师范大学",
    major: "数学教育",
    education: "本科",
    teachingYears: 3,
    subjects: ["数学"],
    serviceDistricts: ["南山区"],
    version: teacherProfile.version
  }
});
await request(`/admin-api/v1/teachers/${teacher.account.id}/audit`, {
  method: "PATCH",
  token: admin.accessToken,
  body: { status: "APPROVED", note: "自动化端到端测试认证" }
});

const job = await request("/api/v1/jobs", {
  method: "POST",
  token: parent.accessToken,
  body: {
    type: "TEACHING_NEED",
    title: `端到端测试数学家教 ${runId}`,
    district: "南山区",
    area: "科技园",
    grade: "高一",
    subject: "数学",
    priceCents: 20000,
    priceUnit: "小时",
    settlement: "周结",
    schedule: "周六 14:00-16:00",
    description: "用于验证审核、报名和录用的完整业务链路。",
    latitude: 22.54042,
    longitude: 113.93457,
    capacity: 1
  }
});
assert.equal(job.status, "PENDING");

await request(`/admin-api/v1/jobs/${job.id}/audit`, {
  method: "PATCH",
  token: admin.accessToken,
  body: { status: "APPROVED", note: "自动化端到端测试发布" }
});

const idempotencyKey = `e2e-apply-${runId}`;
const [firstApply, duplicateApply] = await Promise.all([
  request(`/api/v1/jobs/${job.id}/applications`, {
    method: "POST",
    token: teacher.accessToken,
    headers: { "idempotency-key": idempotencyKey },
    body: { coverLetter: "三年教学经验，可以长期授课。" }
  }),
  request(`/api/v1/jobs/${job.id}/applications`, {
    method: "POST",
    token: teacher.accessToken,
    headers: { "idempotency-key": idempotencyKey },
    body: { coverLetter: "重复网络请求不会生成第二条报名。" }
  })
]);
assert.equal(firstApply.id, duplicateApply.id);

const applications = await request(`/api/v1/parent/jobs/${job.id}/applications`, { token: parent.accessToken });
assert.equal(applications.length, 1);
await request(`/api/v1/applications/${applications[0].id}/accept`, {
  method: "POST",
  token: parent.accessToken,
  body: { note: "端到端测试录用" }
});

const teacherApplications = await request("/api/v1/teacher/applications", { token: teacher.accessToken });
const accepted = teacherApplications.find((item) => item.id === firstApply.id);
assert.equal(accepted.status, "ACCEPTED");

console.log(`E2E passed: file signing -> teacher audit -> job audit -> idempotent apply -> accept (${job.id}).`);
