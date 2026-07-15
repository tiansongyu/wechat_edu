import assert from "node:assert/strict";

const baseUrl = process.env.BASE_URL || "http://127.0.0.1:4000";
const runId = Date.now();
const covered = new Set();

async function raw(path, { token, method = "GET", body, headers = {} } = {}) {
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
  const result = await raw(path, options);
  if (!result.response.ok) {
    throw new Error(`${options.method || "GET"} ${path} -> ${result.response.status}: ${JSON.stringify(result.payload)}`);
  }
  return result.payload;
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

async function login(name, activeRole) {
  const deviceId = `review-${name}-${runId}`;
  return request("POST /api/v1/auth/wechat-login", "/api/v1/auth/wechat-login", {
    method: "POST",
    body: {
      code: `${name}-${runId}`,
      deviceId,
      nickname: name,
      activeRole
    }
  });
}

async function switchRole(session, role) {
  const switched = await request("POST /api/v1/auth/switch-role", "/api/v1/auth/switch-role", {
    method: "POST",
    token: session.accessToken,
    body: { role }
  });
  return { ...session, accessToken: switched.accessToken, account: { ...session.account, activeRole: role } };
}

async function approveTeacher(adminToken, teacher) {
  const current = await request("GET /api/v1/profiles/teacher", "/api/v1/profiles/teacher", {
    token: teacher.accessToken
  });
  const updated = await request("PATCH /api/v1/profiles/teacher", "/api/v1/profiles/teacher", {
    method: "PATCH",
    token: teacher.accessToken,
    body: {
      realName: "评价回归老师",
      bio: "用于验证真实履约评价闭环",
      school: "华南师范大学",
      major: "数学教育",
      education: "本科",
      teachingYears: 5,
      hourlyRateCents: 22000,
      subjects: ["数学"],
      serviceDistricts: ["南山区"],
      version: current.version
    }
  });
  return request(
    "PATCH /admin-api/v1/teachers/:id/audit",
    `/admin-api/v1/teachers/${teacher.account.id}/audit`,
    {
      method: "PATCH",
      token: adminToken,
      body: { status: "APPROVED", note: "评价端到端回归通过", version: updated.version }
    }
  );
}

function jobPayload(index) {
  return {
    type: "TEACHING_NEED",
    title: `评价回归需求-${index}-${runId}`,
    province: "广东省",
    city: "深圳市",
    district: "南山区",
    area: "科技园",
    grade: "高一",
    subject: "数学",
    priceCents: 22000,
    priceUnit: "小时",
    settlement: "课结",
    schedule: "周六 14:00-16:00",
    description: "用于验证双方完成确认、评价资格、聚合和匿名输出。",
    studentInfo: "高一学生",
    address: "深圳市南山区科技园",
    contact: "平台内沟通",
    latitude: 22.54042,
    longitude: 113.93457,
    capacity: 1
  };
}

async function createCompletedAppointment(adminToken, parent, teacher, index, beforeCompletion) {
  const job = await request("POST /api/v1/jobs", "/api/v1/jobs", {
    method: "POST",
    token: parent.accessToken,
    body: jobPayload(index)
  });
  await request("PATCH /admin-api/v1/jobs/:id/audit", `/admin-api/v1/jobs/${job.id}/audit`, {
    method: "PATCH",
    token: adminToken,
    body: { status: "APPROVED", note: "评价回归发布通过", version: job.version }
  });
  const application = await request(
    "POST /api/v1/jobs/:jobId/applications",
    `/api/v1/jobs/${job.id}/applications`,
    {
      method: "POST",
      token: teacher.accessToken,
      headers: { "idempotency-key": `review-apply-${index}-${runId}` },
      body: { coverLetter: "五年教学经验，可以稳定授课。" }
    }
  );
  await request("POST /api/v1/applications/:id/accept", `/api/v1/applications/${application.id}/accept`, {
    method: "POST",
    token: parent.accessToken,
    body: { note: "评价回归录用" }
  });
  const parentAppointments = await request("GET /api/v1/appointments", "/api/v1/appointments", {
    token: parent.accessToken
  });
  const appointment = parentAppointments.find((item) => item.applicationId === application.id);
  assert.ok(appointment, "录用后必须创建可查询的预约");
  assert.equal(appointment.status, "PENDING");

  if (beforeCompletion) await beforeCompletion(appointment);

  const confirmed = await request("POST /api/v1/appointments/:id/confirm", `/api/v1/appointments/${appointment.id}/confirm`, {
    method: "POST",
    token: teacher.accessToken,
    body: {}
  });
  assert.equal(confirmed.status, "CONFIRMED");

  const parentAcknowledgement = await request(
    "POST /api/v1/appointments/:id/complete",
    `/api/v1/appointments/${appointment.id}/complete`,
    { method: "POST", token: parent.accessToken, body: {} }
  );
  assert.equal(parentAcknowledgement.status, "CONFIRMED", "只有一方确认完成时不能进入已完成");
  assert.ok(parentAcknowledgement.parentCompletedAt);
  assert.equal(parentAcknowledgement.teacherCompletedAt, null);

  const completed = await request(
    "POST /api/v1/appointments/:id/complete",
    `/api/v1/appointments/${appointment.id}/complete`,
    { method: "POST", token: teacher.accessToken, body: {} }
  );
  assert.equal(completed.status, "COMPLETED");
  assert.ok(completed.parentCompletedAt);
  assert.ok(completed.teacherCompletedAt);
  assert.ok(completed.completedAt);

  const completedForParent = (await request("GET /api/v1/appointments", "/api/v1/appointments", {
    token: parent.accessToken
  })).find((item) => item.id === appointment.id);
  assert.equal(completedForParent.canReview, true);
  assert.equal(completedForParent.myReview, null);
  assert.deepEqual(completedForParent.reviewTarget, {
    accountId: teacher.account.id,
    role: "TEACHER",
    label: "本次合作老师"
  });
  assert.equal(completedForParent.completionProgress.fullyAcknowledged, true);
  return completed;
}

async function createReview(token, appointmentId, index, rating, content, key = `review-${index}-${runId}`) {
  return request(
    "POST /api/v1/appointments/:id/reviews",
    `/api/v1/appointments/${appointmentId}/reviews`,
    {
      method: "POST",
      token,
      headers: { "idempotency-key": key },
      body: { rating, tags: ["专业耐心", "准时守约", "专业耐心"], content }
    }
  );
}

const health = await request("GET /health", "/health");
assert.equal(health.status, "ok");
const admin = await request("POST /admin-api/v1/auth/login", "/admin-api/v1/auth/login", {
  method: "POST",
  body: {
    username: process.env.ADMIN_USERNAME || "admin",
    password: process.env.ADMIN_PASSWORD || "Admin123456!"
  }
});

const teacher = await login("评价回归老师", "TEACHER");
const outsider = await login("评价越权用户", "PARENT");
await approveTeacher(admin.accessToken, teacher);
await request("PATCH /api/v1/preferences", "/api/v1/preferences", {
  method: "PATCH",
  token: teacher.accessToken,
  body: { jobNotice: false }
});

const parents = await Promise.all([
  login("评价家长甲", "PARENT"),
  login("评价家长乙", "PARENT"),
  login("评价家长丙", "PARENT")
]);

const firstAppointment = await createCompletedAppointment(
  admin.accessToken,
  parents[0],
  teacher,
  1,
  async (appointment) => {
    await expectStatus(409, `/api/v1/appointments/${appointment.id}/reviews`, {
      method: "POST",
      token: parents[0].accessToken,
      headers: { "idempotency-key": `review-too-early-${runId}` },
      body: { rating: 5, tags: ["专业耐心"] }
    });
  }
);

await expectStatus(403, `/api/v1/appointments/${firstAppointment.id}/reviews`, {
  method: "POST",
  token: outsider.accessToken,
  headers: { "idempotency-key": `review-outsider-${runId}` },
  body: { rating: 5, tags: [] }
});

await expectStatus(400, `/api/v1/appointments/${firstAppointment.id}/reviews`, {
  method: "POST",
  token: parents[0].accessToken,
  headers: { "idempotency-key": `review-rating-${runId}` },
  body: { rating: 6, tags: [] }
});
await expectStatus(400, `/api/v1/appointments/${firstAppointment.id}/reviews`, {
  method: "POST",
  token: parents[0].accessToken,
  headers: { "idempotency-key": `review-short-low-${runId}` },
  body: { rating: 2, tags: [], content: "不满意" }
});
await expectStatus(400, `/api/v1/appointments/${firstAppointment.id}/reviews`, {
  method: "POST",
  token: parents[0].accessToken,
  headers: { "idempotency-key": `review-private-${runId}` },
  body: { rating: 5, tags: [], content: "老师电话是13800138000" }
});
await expectStatus(400, `/api/v1/appointments/${firstAppointment.id}/reviews`, {
  method: "POST",
  token: parents[0].accessToken,
  headers: { "idempotency-key": `review-invalid-tag-${runId}` },
  body: { rating: 5, tags: ["随意自定义"] }
});

const firstKey = `review-idempotent-${runId}`;
const firstReview = await createReview(
  parents[0].accessToken,
  firstAppointment.id,
  1,
  5,
  "讲解清楚，整个合作过程很顺畅。",
  firstKey
);
const repeatedReview = await createReview(
  parents[0].accessToken,
  firstAppointment.id,
  1,
  5,
  "讲解清楚，整个合作过程很顺畅。",
  firstKey
);
assert.equal(repeatedReview.id, firstReview.id, "相同幂等键和内容必须返回同一条评价");
const firstAppointmentAfterReview = (await request("GET /api/v1/appointments", "/api/v1/appointments", {
  token: parents[0].accessToken
})).find((item) => item.id === firstAppointment.id);
assert.equal(firstAppointmentAfterReview.canReview, false);
assert.equal(firstAppointmentAfterReview.myReview.id, firstReview.id);
await expectStatus(409, `/api/v1/appointments/${firstAppointment.id}/reviews`, {
  method: "POST",
  token: parents[0].accessToken,
  headers: { "idempotency-key": firstKey },
  body: { rating: 4, tags: ["专业耐心"], content: "更换了同一幂等键的评价内容。" }
});

let wrongRoleParent = await switchRole(parents[0], "TEACHER");
await expectStatus(403, `/api/v1/appointments/${firstAppointment.id}/reviews`, {
  method: "POST",
  token: wrongRoleParent.accessToken,
  headers: { "idempotency-key": `review-wrong-role-${runId}` },
  body: { rating: 5, tags: ["专业耐心"] }
});
wrongRoleParent = await switchRole(wrongRoleParent, "PARENT");

const teacherReview = await request(
  "POST /api/v1/appointments/:id/reviews",
  `/api/v1/appointments/${firstAppointment.id}/reviews`,
  {
    method: "POST",
    token: teacher.accessToken,
    headers: { "idempotency-key": `teacher-review-${runId}` },
    body: { rating: 5, tags: ["需求清晰", "尊重老师"], content: "家长沟通明确，合作安排合理。" }
  }
);
assert.equal(teacherReview.reviewerRole, "TEACHER");
assert.equal(teacherReview.revieweeRole, "PARENT");
const firstAppointmentForTeacher = (await request("GET /api/v1/appointments", "/api/v1/appointments", {
  token: teacher.accessToken
})).find((item) => item.id === firstAppointment.id);
assert.equal(firstAppointmentForTeacher.canReview, false);
assert.equal(firstAppointmentForTeacher.myReview.id, teacherReview.id);
assert.equal(firstAppointmentForTeacher.reviewTarget.role, "PARENT");

let teacherReviews = await request(
  "GET /api/v1/accounts/:accountId/reviews",
  `/api/v1/accounts/${teacher.account.id}/reviews?role=TEACHER`,
  { token: outsider.accessToken }
);
await expectStatus(400, `/api/v1/accounts/${teacher.account.id}/reviews`, {
  token: outsider.accessToken
});
await expectStatus(404, `/api/v1/accounts/${parents[0].account.id}/reviews?role=PARENT`, {
  token: outsider.accessToken
});
assert.equal(teacherReviews.summary.count, 1);
assert.equal(teacherReviews.summary.displayAverage, null);
assert.equal(teacherReviews.items[0].reviewerLabel, "本次合作家长");
const publicReviewJson = JSON.stringify(teacherReviews);
for (const privateValue of [parents[0].account.id, parents[0].account.nickname, parents[0].account.avatarUrl]) {
  if (privateValue) assert.equal(publicReviewJson.includes(privateValue), false, `公开评价不得包含 ${privateValue}`);
}
assert.equal(Object.hasOwn(teacherReviews.items[0], "reviewerId"), false);

const secondAppointment = await createCompletedAppointment(admin.accessToken, parents[1], teacher, 2);
await createReview(parents[1].accessToken, secondAppointment.id, 2, 4, "教学认真，沟通及时，整体体验很好。" );
teacherReviews = await request(
  "GET /api/v1/accounts/:accountId/reviews",
  `/api/v1/accounts/${teacher.account.id}/reviews?role=TEACHER`,
  { token: outsider.accessToken }
);
assert.equal(teacherReviews.summary.count, 2);
assert.equal(teacherReviews.summary.displayAverage, null);

const thirdAppointment = await createCompletedAppointment(admin.accessToken, parents[2], teacher, 3);
await createReview(parents[2].accessToken, thirdAppointment.id, 3, 5, "课程准备充分，孩子能够听懂，值得推荐。" );
teacherReviews = await request(
  "GET /api/v1/accounts/:accountId/reviews",
  `/api/v1/accounts/${teacher.account.id}/reviews?role=TEACHER`,
  { token: outsider.accessToken }
);
assert.equal(teacherReviews.summary.count, 3);
assert.equal(teacherReviews.summary.displayAverage, 4.67);
assert.deepEqual(teacherReviews.summary.distribution, { 1: 0, 2: 0, 3: 0, 4: 1, 5: 2 });
assert.equal(teacherReviews.summary.algorithmVersion, "review-v1");

await request(
  "POST /api/v1/appointments/:id/dispute",
  `/api/v1/appointments/${thirdAppointment.id}/dispute`,
  { method: "POST", token: teacher.accessToken, body: { reason: "验证争议评价自动排除" } }
);
teacherReviews = await request(
  "GET /api/v1/accounts/:accountId/reviews",
  `/api/v1/accounts/${teacher.account.id}/reviews?role=TEACHER`,
  { token: outsider.accessToken }
);
assert.equal(teacherReviews.summary.count, 2);
assert.equal(teacherReviews.summary.displayAverage, null);
assert.equal(teacherReviews.items.some((item) => item.id === firstReview.id), true);

await new Promise((resolve) => setTimeout(resolve, 1500));
const notifications = await request("GET /api/v1/notifications", "/api/v1/notifications", {
  token: teacher.accessToken
});
assert.ok(
  notifications.some((item) => item.title === "收到新的合作评价"),
  "关闭普通业务提醒后，评价关键站内信仍应保留"
);

const expected = [
  "GET /health",
  "POST /admin-api/v1/auth/login",
  "POST /api/v1/auth/wechat-login",
  "POST /api/v1/auth/switch-role",
  "GET /api/v1/profiles/teacher",
  "PATCH /api/v1/profiles/teacher",
  "PATCH /admin-api/v1/teachers/:id/audit",
  "PATCH /api/v1/preferences",
  "POST /api/v1/jobs",
  "PATCH /admin-api/v1/jobs/:id/audit",
  "POST /api/v1/jobs/:jobId/applications",
  "POST /api/v1/applications/:id/accept",
  "GET /api/v1/appointments",
  "POST /api/v1/appointments/:id/confirm",
  "POST /api/v1/appointments/:id/complete",
  "POST /api/v1/appointments/:id/reviews",
  "GET /api/v1/accounts/:accountId/reviews",
  "POST /api/v1/appointments/:id/dispute",
  "GET /api/v1/notifications"
];
for (const endpoint of expected) assert.ok(covered.has(endpoint), `未覆盖接口：${endpoint}`);

console.log(
  `Review E2E passed: mutual completion -> authorization -> idempotency -> anonymous reviews -> threshold -> dispute exclusion (${teacher.account.id}).`
);
