const assert = require("assert").strict;
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const compose = read("compose.yaml");
for (const service of ["gateway", "api", "worker", "migrate", "admin-web", "postgres", "pgbouncer", "redis", "minio"]) {
  assert.match(compose, new RegExp(`\\n  ${service}:`), `compose should include ${service}`);
}
for (const mapping of [
  "${GATEWAY_PORT:-4000}:80",
  "${POSTGRES_PORT:-4001}:5432",
  "${REDIS_PORT:-4002}:6379",
  "${MINIO_API_PORT:-4003}:9000",
  "${MINIO_CONSOLE_PORT:-4004}:9001"
]) {
  assert.ok(compose.includes(mapping), `compose should include port mapping ${mapping}`);
}
assert.match(read("utils/config.js"), /http:\/\/89\.117\.20\.124:4000/);

const schema = read("backend/prisma/schema.prisma");
for (const model of ["Account", "TeacherProfile", "JobPost", "Application", "Appointment", "Review", "ReviewReport", "Conversation", "ConversationMember", "Notification", "UserPreference", "Message", "OutboxEvent", "AuditLog", "SystemSetting"]) {
  assert.match(schema, new RegExp(`model ${model} \\{`), `Prisma should include ${model}`);
}
assert.match(schema, /@@unique\(\[jobId, teacherId\]\)/);
assert.match(schema, /Unsupported\("geography\(Point, 4326\)"\)/);

const appModule = read("backend/src/app.module.ts");
for (const moduleName of ["AuthModule", "ProfilesModule", "JobsModule", "ApplicationsModule", "AppointmentsModule", "ReviewsModule", "PreferencesModule", "AdminModule", "CommunicationsModule", "FilesModule", "PlatformModule"]) {
  assert.match(appModule, new RegExp(moduleName));
}

const migration = read("backend/prisma/migrations/202607150002_workflow_hardening/migration.sql");
for (const field of ["statusNote", "submittedAt", "sourceEventId", "user_preferences"]) {
  assert.ok(migration.includes(field), `workflow migration should persist ${field}`);
}
const authLocationMigration = read("backend/prisma/migrations/202607150005_wechat_login_and_structured_locations/migration.sql");
for (const field of ["lastLoginAt", "loginCount", "deviceIdHash", "province", "city"]) {
  assert.ok(authLocationMigration.includes(field), `auth/location migration should persist ${field}`);
}
const reviewsMigration = read("backend/prisma/migrations/202607160006_completion_reviews/migration.sql");
for (const field of ["parentCompletedAt", "teacherCompletedAt", "completedAt", "requestHash", "claimedAt", "reviews_rating_check"]) {
  assert.ok(reviewsMigration.includes(field), `completion/reviews migration should persist ${field}`);
}
assert.match(reviewsMigration, /UNIQUE INDEX "reviews_appointmentId_reviewerId_key"/);
const reviewRoleIndexMigration = read("backend/prisma/migrations/202607160007_review_role_index/migration.sql");
assert.match(reviewRoleIndexMigration, /reviews_revieweeId_revieweeRole_status_createdAt_idx/);
assert.match(schema, /@@index\(\[revieweeId, revieweeRole, status, createdAt\(sort: Desc\)\]\)/);
const platformSettingMigration = read("backend/prisma/migrations/202607160008_platform_public_setting/migration.sql");
assert.match(platformSettingMigration, /platform\.public/);
assert.match(platformSettingMigration, /ON CONFLICT \("key"\) DO NOTHING/);
const reviewGovernanceMigration = read("backend/prisma/migrations/202607160009_review_governance/migration.sql");
for (const field of ["review_reports", "ReviewReportCategory", "ReviewReportStatus", "statusChangedReason", "version"]) {
  assert.ok(reviewGovernanceMigration.includes(field), `review governance migration should persist ${field}`);
}
const conversationRoleMigration = read("backend/prisma/migrations/202607160010_conversation_role_context/migration.sql");
for (const field of ["jobId", "contextKey", "conversation_members_role_check", "notifications_accountId_sourceEventId_key"]) {
  assert.ok(conversationRoleMigration.includes(field), `conversation role migration should persist ${field}`);
}
assert.match(schema, /contextKey\s+String\?\s+@unique/);
assert.match(schema, /model ConversationMember \{[\s\S]*?role\s+RoleCode\?/);
assert.match(schema, /model Notification \{[\s\S]*?@@unique\(\[accountId, sourceEventId\]\)/);
const platformController = read("backend/src/modules/platform/platform.controller.ts");
assert.match(platformController, /@Public\(\)[\s\S]*@Get\("overview"\)/, "platform overview must work before login");
const authService = read("backend/src/modules/auth/auth.service.ts");
assert.match(authService, /api\.weixin\.qq\.com\/sns\/jscode2session/);
assert.match(authService, /deviceIdHash/);
const resetScript = read("backend/prisma/reset-sample-data.ts");
assert.match(resetScript, /RESET_SAMPLE_DATA/);
assert.match(resetScript, /NODE_ENV === "production"/);
assert.match(resetScript, /RESET_SAMPLE_DATABASE/);
assert.match(resetScript, /ALLOW_REMOTE_SAMPLE_RESET/);
assert.match(resetScript, /TRUNCATE TABLE/);
assert.match(resetScript, /review_reports/);
assert.match(resetScript, /reviews/);
const seedScript = read("backend/prisma/seed.ts");
assert.match(seedScript, /SEED_DEMO_DATA === "true"/);
assert.match(seedScript, /prisma\.review\.upsert/);
assert.match(seedScript, /prisma\.reviewReport\.upsert/);
assert.match(seedScript, /parentCompletedAt: sampleCompletedAt/);
assert.match(seedScript, /teacherCompletedAt: sampleCompletedAt/);
assert.match(seedScript, /CONVERSATION_CONTEXT_KEY/);
assert.match(seedScript, /role: RoleCode\.PARENT/);
assert.match(seedScript, /role: RoleCode\.TEACHER/);
const sampleVerification = read("backend/prisma/verify-sample-data.ts");
assert.match(sampleVerification, /expectedCounts/);
assert.match(sampleVerification, /referentially consistent PostgreSQL business dataset/);
assert.match(sampleVerification, /sample conversation members must retain explicit role bindings/);
const backendPackage = JSON.parse(read("backend/package.json"));
assert.match(backendPackage.scripts["db:reset-sample"], /db:verify-sample/);
assert.match(backendPackage.scripts["test:persistence"], /docker-persistence\.mjs/);
const persistenceTest = read("tests/docker-persistence.mjs");
assert.match(persistenceTest, /RUN_DOCKER_PERSISTENCE_TEST/);
assert.match(persistenceTest, /docker\(\["restart", "postgres", "redis"\]\)/);
assert.match(persistenceTest, /assert\.equal\(after, before/);
assert.match(persistenceTest, /"contextKey"/);
assert.match(persistenceTest, /"conversationId", "accountId", role/);
const productionCompose = read("compose.production.yaml");
assert.match(productionCompose, /WECHAT_LOGIN_MOCK:\s*"false"/);
assert.match(productionCompose, /SEED_DEMO_DATA:\s*"false"/);
assert.match(
  productionCompose,
  /worker:[\s\S]*?environment:[\s\S]*?WECHAT_LOGIN_MOCK:\s*"false"[\s\S]*?SEED_DEMO_DATA:\s*"false"/,
  "production worker must never inherit mock login defaults"
);

for (const nginxConfigPath of ["infra/nginx/default.conf", "infra/nginx/production.conf"]) {
  const nginxConfig = read(nginxConfigPath);
  assert.match(nginxConfig, /resolver 127\.0\.0\.11 valid=10s ipv6=off;/);
  assert.match(nginxConfig, /zone tutor_api 64k;/);
  assert.match(nginxConfig, /server api:3000 resolve;/);
  assert.match(nginxConfig, /zone tutor_admin 64k;/);
  assert.match(nginxConfig, /server admin-web:80 resolve;/);
  assert.match(nginxConfig, /proxy_pass http:\/\/tutor_admin;/);
}

const project = JSON.parse(read("project.config.json"));
assert.equal(project.appid, "wx02054be10e52aff0");
const packIgnore = project.packOptions?.ignore || [];
for (const value of [".git", "admin-web", "backend", "tests", ".env", ".env.example", "compose.yaml"]) {
  assert.ok(packIgnore.some((entry) => entry.value === value), `mini-program package must ignore ${value}`);
}
console.log("Architecture checks passed: Docker services, production safeguards, real WeChat auth path, structured locations, reset guard, persistent workflow models, backend modules, and AppID.");
