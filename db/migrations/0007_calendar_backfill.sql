-- Custom SQL migration file, put your code below! --
-- Every existing tenant gets the default normal hours from its creation date (Phase 4 spec, R4.1).
INSERT INTO "working_hours" ("tenant_id", "effective_from", "week")
SELECT t."id", (t."created_at" AT TIME ZONE 'Asia/Riyadh')::date,
  '{"start":"08:00","end":"16:00","days":{"sun":"default","mon":"default","tue":"default","wed":"default","thu":"default","fri":"off","sat":"off"}}'::jsonb
FROM "tenants" t
WHERE NOT EXISTS (SELECT 1 FROM "working_hours" w WHERE w."tenant_id" = t."id");
