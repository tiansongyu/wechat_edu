import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

if (process.env.RESET_SAMPLE_DATA !== "true") {
  throw new Error("Refusing to delete data. Set RESET_SAMPLE_DATA=true to confirm the sample reset.");
}

if (process.env.NODE_ENV === "production") {
  throw new Error("Refusing to reset sample data while NODE_ENV=production.");
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const databaseUrl = new URL(connectionString);
const databaseName = decodeURIComponent(databaseUrl.pathname.replace(/^\//, ""));
const confirmedDatabase = process.env.RESET_SAMPLE_DATABASE;
if (!confirmedDatabase || confirmedDatabase !== databaseName) {
  throw new Error("Refusing to reset an unconfirmed database. Set RESET_SAMPLE_DATABASE to the exact database name.");
}
const localDatabaseHosts = new Set(["localhost", "127.0.0.1", "::1", "postgres", "pgbouncer"]);
if (!localDatabaseHosts.has(databaseUrl.hostname) && process.env.ALLOW_REMOTE_SAMPLE_RESET !== "true") {
  throw new Error("Refusing to reset a remote database without ALLOW_REMOTE_SAMPLE_RESET=true.");
}
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function main() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      review_reports,
      reviews,
      outbox_events,
      audit_logs,
      idempotency_records,
      notifications,
      messages,
      conversation_members,
      conversations,
      appointments,
      applications,
      favorites,
      teacher_certifications,
      job_posts,
      refresh_sessions,
      user_preferences,
      teacher_profiles,
      parent_profiles,
      account_roles,
      accounts
    RESTART IDENTITY CASCADE
  `);
}

main()
  .then(() => console.log("Existing accounts and business records removed; ready to seed one linked sample."))
  .finally(() => prisma.$disconnect());
