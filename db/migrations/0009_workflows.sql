CREATE TYPE "public"."stage_fallbacks" AS ENUM('escalate', 'skip', 'hold');--> statement-breakpoint
CREATE TABLE "workflow_stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"ordinal" smallint NOT NULL,
	"name" text NOT NULL,
	"target_position_id" uuid,
	"target_builtin" "assignee_builtins",
	"when_unresolved" "stage_fallbacks" NOT NULL,
	"handler_may_narrow" boolean NOT NULL,
	"handler_may_escalate" boolean NOT NULL,
	"exclude_parties" boolean NOT NULL,
	CONSTRAINT "workflow_stages_tenant_version_id_unique" UNIQUE("tenant_id","version_id","id"),
	CONSTRAINT "workflow_stages_ordinal_unique" UNIQUE("version_id","ordinal"),
	CONSTRAINT "workflow_stages_ordinal_range" CHECK ("workflow_stages"."ordinal" between 1 and 20),
	CONSTRAINT "workflow_stages_name_length" CHECK ("workflow_stages"."name" = btrim("workflow_stages"."name") and char_length("workflow_stages"."name") between 1 and 100),
	CONSTRAINT "workflow_stages_one_target" CHECK (num_nonnulls("workflow_stages"."target_position_id", "workflow_stages"."target_builtin") = 1),
	CONSTRAINT "workflow_stages_party_flags" CHECK ("workflow_stages"."target_builtin" is null or "workflow_stages"."target_builtin" not in ('handler', 'requester')
        or (not "workflow_stages"."handler_may_narrow" and not "workflow_stages"."exclude_parties"))
);
--> statement-breakpoint
CREATE TABLE "workflow_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"workflow_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_versions_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "workflow_versions_tenant_workflow_id_unique" UNIQUE("tenant_id","workflow_id","id"),
	CONSTRAINT "workflow_versions_number_unique" UNIQUE("workflow_id","number"),
	CONSTRAINT "workflow_versions_number_positive" CHECK ("workflow_versions"."number" >= 1)
);
--> statement-breakpoint
CREATE TABLE "workflows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"current_version_id" uuid NOT NULL,
	"retired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflows_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "workflows_name_length" CHECK ("workflows"."name" = btrim("workflows"."name") and char_length("workflows"."name") between 1 and 100)
);
--> statement-breakpoint
ALTER TABLE "workflow_stages" ADD CONSTRAINT "workflow_stages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_stages" ADD CONSTRAINT "workflow_stages_version_fk" FOREIGN KEY ("tenant_id","version_id") REFERENCES "public"."workflow_versions"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_stages" ADD CONSTRAINT "workflow_stages_position_fk" FOREIGN KEY ("tenant_id","target_position_id") REFERENCES "public"."positions"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_versions" ADD CONSTRAINT "workflow_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_versions" ADD CONSTRAINT "workflow_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_versions" ADD CONSTRAINT "workflow_versions_workflow_fk" FOREIGN KEY ("tenant_id","workflow_id") REFERENCES "public"."workflows"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_current_version_fk" FOREIGN KEY ("tenant_id","id","current_version_id") REFERENCES "public"."workflow_versions"("tenant_id","workflow_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_stages_name_unique" ON "workflow_stages" USING btree ("version_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "workflows_name_unique" ON "workflows" USING btree ("tenant_id",lower("name")) WHERE "workflows"."retired_at" is null;