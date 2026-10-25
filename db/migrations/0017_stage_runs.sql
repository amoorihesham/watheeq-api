CREATE TYPE "public"."stage_run_states" AS ENUM('active', 'held', 'completed', 'returned', 'skipped', 'cancelled');--> statement-breakpoint
CREATE TABLE "request_stage_assignees" (
	"tenant_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "request_stage_assignees_pk" PRIMARY KEY("run_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "request_stage_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"workflow_version_id" uuid NOT NULL,
	"workflow_stage_id" uuid NOT NULL,
	"ordinal" smallint NOT NULL,
	"state" "stage_run_states" NOT NULL,
	"level" jsonb,
	"narrowed" boolean DEFAULT false NOT NULL,
	"escalated" boolean DEFAULT false NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"ended_by" uuid,
	"comment" text,
	CONSTRAINT "request_stage_runs_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "request_stage_runs_ended" CHECK (("request_stage_runs"."state" in ('active', 'held')) = ("request_stage_runs"."ended_at" is null)),
	CONSTRAINT "request_stage_runs_level" CHECK (("request_stage_runs"."state" <> 'active' or "request_stage_runs"."level" is not null) and ("request_stage_runs"."state" <> 'held' or "request_stage_runs"."level" is null)),
	CONSTRAINT "request_stage_runs_comment_length" CHECK ("request_stage_runs"."comment" is null or char_length("request_stage_runs"."comment") between 1 and 2000)
);
--> statement-breakpoint
ALTER TABLE "request_stage_assignees" ADD CONSTRAINT "request_stage_assignees_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_stage_assignees" ADD CONSTRAINT "request_stage_assignees_run_fk" FOREIGN KEY ("tenant_id","run_id") REFERENCES "public"."request_stage_runs"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_stage_assignees" ADD CONSTRAINT "request_stage_assignees_user_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."tenant_members"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_stage_runs" ADD CONSTRAINT "request_stage_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_stage_runs" ADD CONSTRAINT "request_stage_runs_request_fk" FOREIGN KEY ("tenant_id","request_id","workflow_version_id") REFERENCES "public"."requests"("tenant_id","id","workflow_version_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_stage_runs" ADD CONSTRAINT "request_stage_runs_stage_fk" FOREIGN KEY ("tenant_id","workflow_version_id","workflow_stage_id") REFERENCES "public"."workflow_stages"("tenant_id","version_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_stage_runs" ADD CONSTRAINT "request_stage_runs_ended_by_fk" FOREIGN KEY ("tenant_id","ended_by") REFERENCES "public"."tenant_members"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "request_stage_assignees_user_idx" ON "request_stage_assignees" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "request_stage_runs_live_unique" ON "request_stage_runs" USING btree ("request_id") WHERE "request_stage_runs"."state" in ('active', 'held');--> statement-breakpoint
CREATE INDEX "request_stage_runs_request_idx" ON "request_stage_runs" USING btree ("tenant_id","request_id");