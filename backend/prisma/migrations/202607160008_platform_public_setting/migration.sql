-- Public platform copy is database-backed. Keep an existing operator-managed value unchanged.
INSERT INTO "system_settings" ("key", "value", "updatedAt")
VALUES (
  'platform.public',
  '{"brand":{"name":"家教直聘","slogan":"认真匹配每一次教与学"},"trustHighlights":["教师资料经平台审核","真实合作才能评价","隐私信息分级保护"]}'::jsonb,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("key") DO NOTHING;
