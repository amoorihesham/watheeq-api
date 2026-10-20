ALTER TABLE "audit_log" ALTER COLUMN "tenant_id" DROP NOT NULL;--> statement-breakpoint
CREATE INDEX "audit_log_platform_occurred_idx" ON "audit_log" USING btree ("occurred_at") WHERE "audit_log"."tenant_id" is null;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_has_tenant" CHECK ("audit_log"."tenant_id" is not null or "audit_log"."actor_type" <> 'user');