const assert = require("assert").strict;
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const compose = read("compose.yaml");
for (const service of ["gateway", "api", "worker", "migrate", "admin-web", "postgres", "pgbouncer", "redis", "minio"]) {
  assert.match(compose, new RegExp(`\\n  ${service}:`), `compose should include ${service}`);
}

const schema = read("backend/prisma/schema.prisma");
for (const model of ["Account", "TeacherProfile", "JobPost", "Application", "Appointment", "Message", "OutboxEvent", "AuditLog"]) {
  assert.match(schema, new RegExp(`model ${model} \\{`), `Prisma should include ${model}`);
}
assert.match(schema, /@@unique\(\[jobId, teacherId\]\)/);
assert.match(schema, /Unsupported\("geography\(Point, 4326\)"\)/);

const appModule = read("backend/src/app.module.ts");
for (const moduleName of ["AuthModule", "ProfilesModule", "JobsModule", "ApplicationsModule", "AdminModule", "CommunicationsModule", "FilesModule"]) {
  assert.match(appModule, new RegExp(moduleName));
}

const project = JSON.parse(read("project.config.json"));
assert.equal(project.appid, "wx02054be10e52aff0");
console.log("Architecture checks passed: Docker services, Prisma models, backend modules, and AppID.");
