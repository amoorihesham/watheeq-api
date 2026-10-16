-- Edited by hand after generation: the foreign key is declared inline in CREATE TABLE instead of a separate ALTER TABLE ADD CONSTRAINT.
-- Validating an added FK reads tenants, and tenants has FORCE ROW LEVEL SECURITY, so the owner would hit 'tenant context is not set'.
-- Every later migration that adds a tenant_id FK to tenants must do the same.
CREATE TABLE "audit_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"tenant_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text NOT NULL,
	"reason" text,
	"details" jsonb,
	"request_id" text NOT NULL,
	CONSTRAINT "audit_log_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action,
	CONSTRAINT "audit_log_actor_type" CHECK ("audit_log"."actor_type" in ('user', 'operator', 'system')),
	CONSTRAINT "audit_log_actor_id" CHECK ("audit_log"."actor_type" = 'system' or "audit_log"."actor_id" is not null)
);
--> statement-breakpoint
CREATE INDEX "audit_log_tenant_occurred_idx" ON "audit_log" USING btree ("tenant_id","occurred_at");