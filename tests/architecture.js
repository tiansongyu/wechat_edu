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
assert.match(read("utils/config.js"), /127\.0\.0\.1:4000/);

const schema = read("backend/prisma/schema.prisma");
for (const model of ["Account", "TeacherProfile", "JobPost", "Application", "Appointment", "UserPreference", "Message", "OutboxEvent", "AuditLog"]) {
  assert.match(schema, new RegExp(`model ${model} \\{`), `Prisma should include ${model}`);
}
assert.match(schema, /@@unique\(\[jobId, teacherId\]\)/);
assert.match(schema, /Unsupported\("geography\(Point, 4326\)"\)/);

const appModule = read("backend/src/app.module.ts");
for (const moduleName of ["AuthModule", "ProfilesModule", "JobsModule", "ApplicationsModule", "AppointmentsModule", "PreferencesModule", "AdminModule", "CommunicationsModule", "FilesModule"]) {
  assert.match(appModule, new RegExp(moduleName));
}

const migration = read("backend/prisma/migrations/202607150002_workflow_hardening/migration.sql");
for (const field of ["statusNote", "submittedAt", "sourceEventId", "user_preferences"]) {
  assert.ok(migration.includes(field), `workflow migration should persist ${field}`);
}
const productionCompose = read("compose.production.yaml");
assert.match(productionCompose, /WECHAT_LOGIN_MOCK:\s*"false"/);
assert.match(productionCompose, /SEED_DEMO_DATA:\s*"false"/);

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
console.log("Architecture checks passed: Docker services, production safeguards, dynamic upstream DNS, persistent workflow models, backend modules, and AppID.");
