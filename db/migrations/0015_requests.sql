CREATE TYPE "public"."request_states" AS ENUM('in_review', 'in_progress', 'completed', 'rejected', 'rejected_no_response', 'withdrawn');--> statement-breakpoint
CREATE TABLE "number_sequences" (
	"tenant_id" uuid NOT NULL,
	"prefix" text NOT NULL,
	"year" smallint NOT NULL,
	"last_value" integer NOT NULL,
	CONSTRAINT "number_sequences_pk" PRIMARY KEY("tenant_id","prefix","year"),
	CONSTRAINT "number_sequences_prefix" CHECK ("number_sequences"."prefix" in ('REQ')),
	CONSTRAINT "number_sequences_last_value" CHECK ("number_sequences"."last_value" >= 1)
);
--> statement-breakpoint
CREATE TABLE "requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"year" smallint NOT NULL,
	"number" integer NOT NULL,
	"state" "request_states" NOT NULL,
	"title" text NOT NULL,
	"service_id" uuid NOT NULL,
	"service_name" text NOT NULL,
	"form_revision" integer NOT NULL,
	"answers" jsonb NOT NULL,
	"requester_id" uuid NOT NULL,
	"requester_unit_id" uuid,
	"priority_id" uuid NOT NULL,
	"priority_name" text NOT NULL,
	"priority_days" smallint NOT NULL,
	"handler_id" uuid,
	"handler_unit_id" uuid,
	"workflow_id" uuid,
	"workflow_version_id" uuid,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_by" uuid,
	"closed_at" timestamp with time zone,
	"closed_by" uuid,
	"close_reason" text,
	"sla_deadline" timestamp with time zone,
	"elapsed_days" numeric(12, 6),
	"breach_days" numeric(12, 6),
	"awaiting_info_days" numeric(12, 6),
	"sla_met" boolean,
	CONSTRAINT "requests_number_unique" UNIQUE("tenant_id","year","number"),
	CONSTRAINT "requests_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "requests_tenant_id_version_unique" UNIQUE("tenant_id","id","workflow_version_id"),
	CONSTRAINT "requests_title_length" CHECK ("requests"."title" = btrim("requests"."title") and char_length("requests"."title") between 1 and 200),
	CONSTRAINT "requests_answers_is_array" CHECK (jsonb_typeof("requests"."answers") = 'array'),
	CONSTRAINT "requests_accepted_columns" CHECK (("requests"."state" in ('in_progress', 'completed', 'rejected_no_response')) = (
        "requests"."handler_id" is not null and "requests"."workflow_id" is not null and "requests"."workflow_version_id" is not null
        and "requests"."accepted_at" is not null and "requests"."accepted_by" is not null
      )),
	CONSTRAINT "requests_not_accepted_columns" CHECK ("requests"."state" in ('in_progress', 'completed', 'rejected_no_response') or (
        "requests"."handler_id" is null and "requests"."workflow_id" is null and "requests"."workflow_version_id" is null
        and "requests"."handler_unit_id" is null and "requests"."accepted_at" is null and "requests"."accepted_by" is null
      )),
	CONSTRAINT "requests_closed_columns" CHECK (("requests"."state" not in ('in_review', 'in_progress')) = ("requests"."closed_at" is not null and "requests"."closed_by" is not null)),
	CONSTRAINT "requests_close_reason" CHECK (("requests"."state" in ('rejected', 'withdrawn', 'rejected_no_response')) = ("requests"."close_reason" is not null)),
	CONSTRAINT "requests_sla_record" CHECK (("requests"."state" in ('completed', 'rejected_no_response')) = (
        "requests"."sla_deadline" is not null and "requests"."elapsed_days" is not null and "requests"."breach_days" is not null
        and "requests"."awaiting_info_days" is not null and "requests"."sla_met" is not null
      )),
	CONSTRAINT "requests_sla_record_absent" CHECK ("requests"."state" in ('completed', 'rejected_no_response') or (
        "requests"."sla_deadline" is null and "requests"."elapsed_days" is null and "requests"."breach_days" is null
        and "requests"."awaiting_info_days" is null and "requests"."sla_met" is null
      ))
);
--> statement-breakpoint
ALTER TABLE "number_sequences" ADD CONSTRAINT "number_sequences_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_service_fk" FOREIGN KEY ("tenant_id","service_id") REFERENCES "public"."services"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_requester_fk" FOREIGN KEY ("tenant_id","requester_id") REFERENCES "public"."tenant_members"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_requester_unit_fk" FOREIGN KEY ("tenant_id","requester_unit_id") REFERENCES "public"."org_units"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_priority_fk" FOREIGN KEY ("tenant_id","priority_id") REFERENCES "public"."priorities"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_handler_fk" FOREIGN KEY ("tenant_id","handler_id") REFERENCES "public"."tenant_members"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_handler_unit_fk" FOREIGN KEY ("tenant_id","handler_unit_id") REFERENCES "public"."org_units"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_workflow_version_fk" FOREIGN KEY ("tenant_id","workflow_id","workflow_version_id") REFERENCES "public"."workflow_versions"("tenant_id","workflow_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_accepted_by_fk" FOREIGN KEY ("tenant_id","accepted_by") REFERENCES "public"."tenant_members"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_closed_by_fk" FOREIGN KEY ("tenant_id","closed_by") REFERENCES "public"."tenant_members"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "requests_state_idx" ON "requests" USING btree ("tenant_id","state");--> statement-breakpoint
CREATE INDEX "requests_requester_idx" ON "requests" USING btree ("tenant_id","requester_id");--> statement-breakpoint
CREATE INDEX "requests_handler_idx" ON "requests" USING btree ("tenant_id","handler_id");--> statement-breakpoint
CREATE INDEX "requests_requester_unit_idx" ON "requests" USING btree ("tenant_id","requester_unit_id");--> statement-breakpoint
CREATE INDEX "requests_handler_unit_idx" ON "requests" USING btree ("tenant_id","handler_unit_id");