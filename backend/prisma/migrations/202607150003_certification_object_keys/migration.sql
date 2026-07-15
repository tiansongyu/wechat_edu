ALTER TABLE "teacher_certifications"
  ALTER COLUMN "fileUrl" DROP NOT NULL,
  ADD COLUMN "objectKey" VARCHAR(500);
