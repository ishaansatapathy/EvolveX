-- Multi-tenant webhook secrets: eBPF / feature-flag / CI-CD join Kubernetes as
-- per-organization "shared secret" webhook providers (instead of one global
-- EBPF_WEBHOOK_SECRET / FEATURE_FLAG_WEBHOOK_SECRET / CICD_WEBHOOK_SECRET env
-- var shared by every tenant), plus a hash-indexed lookup column so an inbound
-- webhook resolves its organization in O(1) instead of decrypting every row.
DO $$ BEGIN
  ALTER TABLE "organization_integrations" DROP CONSTRAINT IF EXISTS "organization_integrations_provider_check";
EXCEPTION WHEN undefined_object THEN NULL; END $$;

ALTER TABLE "organization_integrations" ADD CONSTRAINT "organization_integrations_provider_check"
  CHECK ("provider" in ('signoz', 'github', 'slack', 'pagerduty', 'jira', 'kubernetes', 'ebpf', 'feature_flag', 'cicd'));

ALTER TABLE "organization_integrations" ADD COLUMN IF NOT EXISTS "secret_hash" varchar(64);
ALTER TABLE "organization_integrations" ADD COLUMN IF NOT EXISTS "previous_secret_hash" varchar(64);
ALTER TABLE "organization_integrations" ADD COLUMN IF NOT EXISTS "previous_secret_expires_at" timestamp;

CREATE INDEX IF NOT EXISTS "organization_integrations_secret_hash_idx"
  ON "organization_integrations" ("provider", "secret_hash");

CREATE INDEX IF NOT EXISTS "organization_integrations_previous_secret_hash_idx"
  ON "organization_integrations" ("provider", "previous_secret_hash");
