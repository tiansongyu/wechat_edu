ALTER TABLE accounts
  ADD COLUMN "lastLoginAt" TIMESTAMPTZ(3),
  ADD COLUMN "loginCount" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE parent_profiles
  ADD COLUMN province VARCHAR(64),
  ADD COLUMN latitude DECIMAL(10, 7),
  ADD COLUMN longitude DECIMAL(10, 7);

ALTER TABLE job_posts
  ADD COLUMN province VARCHAR(64),
  ADD COLUMN city VARCHAR(64);

ALTER TABLE refresh_sessions
  ADD COLUMN "deviceIdHash" VARCHAR(128);

UPDATE parent_profiles
SET province = '广东省', city = '深圳市'
WHERE province IS NULL
  AND city IN ('深圳', '深圳市');

UPDATE job_posts
SET province = '广东省', city = '深圳市'
WHERE province IS NULL
  AND district IN ('南山区', '福田区', '宝安区', '龙华区', '罗湖区');
