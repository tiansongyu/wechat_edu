import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

if (process.env.RUN_DOCKER_PERSISTENCE_TEST !== "true") {
  throw new Error("Set RUN_DOCKER_PERSISTENCE_TEST=true to allow the test to restart local Docker services.");
}

const composeArgs = ["compose"];
if (process.env.PERSISTENCE_COMPOSE_PRODUCTION === "true") {
  composeArgs.push("-f", "compose.yaml", "-f", "compose.production.yaml");
}
const healthUrl = process.env.PERSISTENCE_HEALTH_URL || "http://127.0.0.1:4000/health";

const snapshotSql = String.raw`
WITH business_state AS (
  SELECT jsonb_build_object(
    'accounts', (SELECT COALESCE(jsonb_agg(jsonb_build_array(id, status, nickname) ORDER BY id), '[]'::jsonb) FROM accounts),
    'parent_profiles', (SELECT COALESCE(jsonb_agg(jsonb_build_array("accountId", province, city, district, address) ORDER BY "accountId"), '[]'::jsonb) FROM parent_profiles),
    'teacher_profiles', (SELECT COALESCE(jsonb_agg(jsonb_build_array("accountId", "auditStatus", version) ORDER BY "accountId"), '[]'::jsonb) FROM teacher_profiles),
    'jobs', (SELECT COALESCE(jsonb_agg(jsonb_build_array(id, "ownerId", status, version, "applicationCount") ORDER BY id), '[]'::jsonb) FROM job_posts),
    'applications', (SELECT COALESCE(jsonb_agg(jsonb_build_array(id, "jobId", "teacherId", status, version) ORDER BY id), '[]'::jsonb) FROM applications),
    'appointments', (SELECT COALESCE(jsonb_agg(jsonb_build_array(id, "applicationId", status, version, "parentCompletedAt", "teacherCompletedAt", "completedAt") ORDER BY id), '[]'::jsonb) FROM appointments),
    'reviews', (SELECT COALESCE(jsonb_agg(jsonb_build_array(id, "appointmentId", "reviewerId", "revieweeId", status, version, rating) ORDER BY id), '[]'::jsonb) FROM reviews),
    'review_reports', (SELECT COALESCE(jsonb_agg(jsonb_build_array(id, "reviewId", "reporterId", status, version) ORDER BY id), '[]'::jsonb) FROM review_reports),
    'favorites', (SELECT COALESCE(jsonb_agg(jsonb_build_array("accountId", "jobId") ORDER BY "accountId", "jobId"), '[]'::jsonb) FROM favorites),
    'conversations', (SELECT COALESCE(jsonb_agg(jsonb_build_array(id, "jobId", "contextKey") ORDER BY id), '[]'::jsonb) FROM conversations),
    'conversation_members', (SELECT COALESCE(jsonb_agg(jsonb_build_array("conversationId", "accountId", role) ORDER BY "conversationId", "accountId"), '[]'::jsonb) FROM conversation_members),
    'messages', (SELECT COALESCE(jsonb_agg(jsonb_build_array(id, "conversationId", "senderId", md5(content)) ORDER BY id), '[]'::jsonb) FROM messages),
    'system_settings', (SELECT COALESCE(jsonb_agg(jsonb_build_array(key, value) ORDER BY key), '[]'::jsonb) FROM system_settings)
  ) AS payload
)
SELECT md5(payload::text) FROM business_state;
`;

function docker(args, options = {}) {
  const result = spawnSync("docker", [...composeArgs, ...args], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
    ...options
  });
  if (result.status !== 0) {
    throw new Error(`docker compose ${args.join(" ")} failed: ${(result.stderr || result.stdout || "unknown error").trim()}`);
  }
  return result.stdout.trim();
}

function snapshot() {
  const result = docker(
    ["exec", "-T", "postgres", "sh", "-lc", 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At'],
    { input: snapshotSql }
  );
  assert.match(result, /^[a-f0-9]{32}$/, "PostgreSQL must return one privacy-safe business-state digest");
  return result;
}

async function waitForPostgres() {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    try {
      docker(["exec", "-T", "postgres", "sh", "-lc", 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"']);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
  throw new Error("PostgreSQL did not become ready after restart");
}

async function waitForApi() {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(healthUrl);
      if (response.ok) return;
    } catch {
      // The gateway is expected to be briefly unavailable while services restart.
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`API did not become healthy after restart: ${healthUrl}`);
}

docker(["ps"]);
const before = snapshot();
docker(["restart", "postgres", "redis"]);
await waitForPostgres();
docker(["restart", "api", "worker"]);
await waitForApi();
const after = snapshot();

assert.equal(after, before, "PostgreSQL business state changed across the Docker restart");
console.log(`Docker persistence passed: PostgreSQL business digest ${after} survived database, cache, API and worker restarts.`);
