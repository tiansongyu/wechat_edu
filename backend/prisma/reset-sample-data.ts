import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

if (process.env.RESET_SAMPLE_DATA !== "true") {
  throw new Error("Refusing to delete data. Set RESET_SAMPLE_DATA=true to confirm the sample reset.");
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function main() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
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
