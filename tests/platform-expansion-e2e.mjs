import assert from "node:assert/strict";

const baseUrl = process.env.BASE_URL || "http://127.0.0.1:4000";
const runId = Date.now();
const evidence = {};

async function raw(path, { token, method = "GET", body, headers = {} } = {}) {
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

async function request(path, options = {}) {
  const result = await raw(path, options);
  if (!result.response.ok) {
    throw new Error(`${options.method || "GET"} ${path} -> ${result.response.status}: ${JSON.stringify(result.payload)}`);
  }
  return result.payload;
}

async function login(label, activeRole) {
  const deviceId = `expansion-${label}-${runId}`;
  return request("/api/v1/auth/wechat-login", {
    method: "POST",
    body: { code: deviceId, deviceId, nickname: label, activeRole }
  });
}

async function uploadAvatar(session, color) {
  const png = Buffer.from(
    color === "blue"
      ? "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
      : "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=",
    "base64"
  );
  const signed = await request("/api/v1/files/upload-url", {
    method: "POST",
    token: session.accessToken,
    body: { purpose: "AVATAR", fileName: `${color}.png`, contentType: "image/png", size: png.length }
  });
  assert.match(signed.objectKey, new RegExp(`^avatars/${session.account.id}/`));
  const uploaded = await fetch(signed.uploadUrl, {
    method: "PUT",
    headers: { "content-type": "image/png" },
    body: png
  });
  assert.ok(uploaded.ok, `MinIO PUT must succeed: ${uploaded.status}`);
  const account = await request("/api/v1/auth/me", {
    method: "PATCH",
    token: session.accessToken,
    body: { avatarObjectKey: signed.objectKey }
  });
  assert.match(account.avatarUrl, /^\/media\/tutor-link\/avatars\//);
  const publicAvatar = await fetch(`${baseUrl}${account.avatarUrl}`);
  assert.ok(publicAvatar.ok, `public avatar must be readable: ${publicAvatar.status}`);
  assert.equal(publicAvatar.headers.get("content-type"), "image/png");
  assert.equal((await publicAvatar.arrayBuffer()).byteLength, png.length);
  return { objectKey: signed.objectKey, avatarUrl: account.avatarUrl, bytes: png.length };
}

function jobPayload(subject, marker) {
  return {
    type: "TEACHING_NEED",
    title: `${subject}精准搜索-${marker}-${runId}`,
    province: "广东省",
    city: "深圳市",
    district: "南山区",
    area: "科技园",
    grade: subject === "数学" ? "高一" : "初二",
    subject,
    priceCents: subject === "数学" ? 23800 : 16800,
    priceUnit: "小时",
    settlement: "课结",
    schedule: "周六 14:00-16:00",
    description: subject === "数学" ? "重点辅导函数与几何，要求讲练结合。" : "英语语法与阅读训练。",
    studentInfo: subject === "数学" ? "函数基础薄弱，希望建立错题复盘方法" : "阅读速度需要提升",
    address: "深圳市南山区科技园",
    contact: "platform-wechat",
    latitude: 22.54042,
    longitude: 113.93457,
    capacity: 1
  };
}

async function approveJob(adminToken, job) {
  return request(`/admin-api/v1/jobs/${job.id}/audit`, {
    method: "PATCH",
    token: adminToken,
    body: { status: "APPROVED", note: "扩展功能集成测试通过", version: job.version }
  });
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
const parent = await login("扩展测试家长", "PARENT");
const teacher = await login("扩展测试老师", "TEACHER");

evidence.parentAvatar = await uploadAvatar(parent, "blue");
evidence.teacherAvatar = await uploadAvatar(teacher, "green");

const parentProfile = await request("/api/v1/profiles/parent", {
  method: "PATCH",
  token: parent.accessToken,
  body: {
    province: "广东省",
    city: "深圳市",
    district: "南山区",
    address: "深圳市南山区科技园",
    latitude: 22.54042,
    longitude: 113.93457,
    studentNickname: "小航",
    studentGender: "男",
    studentGrade: "高一",
    schoolName: "测试中学",
    currentLevel: "数学函数基础薄弱",
    targetGoal: "期末达到 90 分",
    weakSubjects: ["数学", "物理"],
    learningGoals: ["提分", "学习习惯"],
    learningStyle: "讲练结合",
    personalityNotes: "需要先示范再独立练习",
    preferredSchedule: ["周六下午"],
    tutorExpectations: "每节课提供学习反馈"
  }
});
assert.deepEqual(parentProfile.weakSubjects, ["数学", "物理"]);

const initialTeacherProfile = await request("/api/v1/profiles/teacher", { token: teacher.accessToken });
const teacherProfile = await request("/api/v1/profiles/teacher", {
  method: "PATCH",
  token: teacher.accessToken,
  body: {
    realName: "扩展测试老师",
    school: "华南师范大学",
    major: "数学教育",
    education: "本科",
    teachingYears: 6,
    hourlyRateCents: 23800,
    subjects: ["数学", "物理"],
    serviceAreas: [
      { province: "广东省", city: "深圳市", district: "南山区" },
      { province: "广东省", city: "深圳市", district: "福田区" }
    ],
    displayTitle: "初高中数理提分老师",
    teachingStyle: "诊断、讲解、练习、复盘四步闭环",
    teachingAchievements: "匿名样例：帮助学生建立函数知识图谱",
    examExperience: "熟悉深圳中高考题型",
    languages: ["普通话", "英语"],
    availableTimes: ["周六下午", "周日晚间"],
    serviceModes: ["上门", "在线"],
    lessonFormats: ["一对一", "作业答疑"],
    bio: "六年教学经验，重视方法和反馈。",
    version: initialTeacherProfile.version
  }
});
assert.equal(teacherProfile.serviceAreas.length, 2);
assert.deepEqual(teacherProfile.serviceDistricts, ["广东省 / 深圳市 / 南山区", "广东省 / 深圳市 / 福田区"]);
await request(`/admin-api/v1/teachers/${teacher.account.id}/audit`, {
  method: "PATCH",
  token: admin.accessToken,
  body: { status: "APPROVED", note: "扩展资料审核通过", version: teacherProfile.version }
});
evidence.profiles = {
  studentGrade: parentProfile.studentGrade,
  weakSubjects: parentProfile.weakSubjects,
  teacherServiceAreas: teacherProfile.serviceAreas,
  teacherModes: teacherProfile.serviceModes
};

const mathJob = await request("/api/v1/jobs", {
  method: "POST",
  token: parent.accessToken,
  body: jobPayload("数学", "目标")
});
const englishJob = await request("/api/v1/jobs", {
  method: "POST",
  token: parent.accessToken,
  body: jobPayload("英语", "对照")
});
await approveJob(admin.accessToken, mathJob);
await approveJob(admin.accessToken, englishJob);

const search = await request(`/api/v1/jobs?type=TEACHING_NEED&keyword=${encodeURIComponent("函数")}&subjects=${encodeURIComponent("数学,物理")}&district=${encodeURIComponent("南山区")}&settlement=${encodeURIComponent("课结")}&sort=PRICE_DESC&limit=50`, {
  token: teacher.accessToken
});
assert.ok(search.items.some((item) => item.id === mathJob.id), "keyword + multi-subject search must return target job");
assert.equal(search.items.some((item) => item.id === englishJob.id), false, "unmatched subject must be excluded");
evidence.search = { query: "函数 + 数学/物理 + 南山区 + 课结", resultIds: search.items.map((item) => item.id) };

const publishedBefore = await request(`/api/v1/jobs/${mathJob.id}`, { token: parent.accessToken });
const revisedTitle = `审核后新标题-${runId}`;
const revisionRequest = await request(`/api/v1/jobs/${mathJob.id}`, {
  method: "PATCH",
  token: parent.accessToken,
  body: { title: revisedTitle, description: "修改申请通过后才应展示的新描述。", version: publishedBefore.version }
});
assert.equal(revisionRequest.revisionPending, true);
const stillPublished = await request(`/api/v1/jobs/${mathJob.id}`, { token: teacher.accessToken });
assert.equal(stillPublished.title, publishedBefore.title, "pending revision must not overwrite public data");
const revisionAudits = await request("/admin-api/v1/job-revisions/audits?pageSize=100", { token: admin.accessToken });
const revision = revisionAudits.items.find((item) => item.jobId === mathJob.id);
assert.ok(revision, "admin must see pending revision");
await request(`/admin-api/v1/job-revisions/${revision.id}/audit`, {
  method: "PATCH",
  token: admin.accessToken,
  body: { status: "APPROVED", note: "修改内容合规", version: revision.version }
});
const publishedAfter = await request(`/api/v1/jobs/${mathJob.id}`, { token: teacher.accessToken });
assert.equal(publishedAfter.title, revisedTitle);
evidence.revision = {
  revisionId: revision.id,
  titleWhilePending: stillPublished.title,
  titleAfterApproval: publishedAfter.title
};

const coverLetter = "我有六年数理教学经验，周六下午可先沟通学习目标。";
const application = await request(`/api/v1/jobs/${mathJob.id}/applications`, {
  method: "POST",
  token: teacher.accessToken,
  headers: { "idempotency-key": `expansion-apply-${runId}` },
  body: { coverLetter }
});
assert.ok(application.conversationId, "application must create a conversation");
const ownerApplications = await request(`/api/v1/parent/jobs/${mathJob.id}/applications`, { token: parent.accessToken });
const ownerApplication = ownerApplications.find((item) => item.id === application.id);
assert.equal(ownerApplication.conversation.id, application.conversationId);
const startedBeforeAccept = await request("/api/v1/conversations", {
  method: "POST",
  token: parent.accessToken,
  body: { memberId: teacher.account.id, jobId: mathJob.id }
});
assert.equal(startedBeforeAccept.id, application.conversationId, "owner can communicate before accepting");
const initialMessages = await request(`/api/v1/conversations/${application.conversationId}/messages`, { token: parent.accessToken });
assert.ok(initialMessages.items.some((item) => item.content === coverLetter));
const reply = await request(`/api/v1/conversations/${application.conversationId}/messages`, {
  method: "POST",
  token: parent.accessToken,
  body: { clientMessageId: crypto.randomUUID(), content: "收到，请先说明函数模块的学习计划。" }
});
assert.equal(reply.content, "收到，请先说明函数模块的学习计划。");

await request(`/api/v1/applications/${application.id}/accept`, {
  method: "POST",
  token: parent.accessToken,
  headers: { "idempotency-key": `expansion-accept-${runId}` },
  body: { note: "沟通后确认合作" }
});
const appointments = await request("/api/v1/appointments", { token: parent.accessToken });
const appointment = appointments.find((item) => item.applicationId === application.id);
assert.ok(appointment, "accepting an application must create an appointment");
await request(`/api/v1/appointments/${appointment.id}/confirm`, {
  method: "POST",
  token: teacher.accessToken,
  headers: { "idempotency-key": `expansion-confirm-${runId}` },
  body: {}
});
await request(`/api/v1/appointments/${appointment.id}/complete`, {
  method: "POST",
  token: parent.accessToken,
  headers: { "idempotency-key": `expansion-parent-complete-${runId}` },
  body: {}
});
const completed = await request(`/api/v1/appointments/${appointment.id}/complete`, {
  method: "POST",
  token: teacher.accessToken,
  headers: { "idempotency-key": `expansion-teacher-complete-${runId}` },
  body: {}
});
assert.equal(completed.status, "COMPLETED");

const parentReview = await request(`/api/v1/appointments/${appointment.id}/reviews`, {
  method: "POST",
  token: parent.accessToken,
  headers: { "idempotency-key": `expansion-parent-review-${runId}` },
  body: { rating: 5, tags: ["专业耐心", "表达清楚", "准时守约"], content: "函数讲解清晰，课后反馈完整，合作体验很好。" }
});
const teacherReview = await request(`/api/v1/appointments/${appointment.id}/reviews`, {
  method: "POST",
  token: teacher.accessToken,
  headers: { "idempotency-key": `expansion-teacher-review-${runId}` },
  body: { rating: 5, tags: ["需求清晰", "尊重老师"], content: "家长目标明确，沟通及时，课程安排合理。" }
});
const publicReviews = await request(`/api/v1/teachers/${teacher.account.id}/reviews?limit=50`, { token: parent.accessToken });
assert.ok(publicReviews.items.some((item) => item.id === parentReview.id && item.rating === 5));
const parentReceived = await request("/api/v1/me/reviews/received?limit=50", { token: parent.accessToken });
assert.ok(parentReceived.items.some((item) => item.id === teacherReview.id && item.rating === 5));
evidence.workflow = {
  applicationId: application.id,
  conversationId: application.conversationId,
  coverLetterPersisted: true,
  replyMessageId: reply.id,
  appointmentId: appointment.id,
  completedStatus: completed.status
};
evidence.reviews = {
  parentReviewId: parentReview.id,
  teacherReviewId: teacherReview.id,
  publicTeacherReviewVisible: true,
  parentReceivedReviewVisible: true,
  rating: 5
};

console.log(`Platform expansion E2E passed:\n${JSON.stringify(evidence, null, 2)}`);
