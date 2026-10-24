CREATE TYPE "public"."escalation_rules" AS ENUM('r0', 'r1', 'r2');--> statement-breakpoint
CREATE TABLE "escalation_recipients" (
	"tenant_id" uuid NOT NULL,
	"rule" "escalation_rules" NOT NULL,
	"target_position_id" uuid,
	"target_builtin" "assignee_builtins",
	CONSTRAINT "escalation_recipients_one_target" CHECK (num_nonnulls("escalation_recipients"."target_position_id", "escalation_recipients"."target_builtin") = 1)
);
--> statement-breakpoint
CREATE TABLE "escalation_settings" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"r0_enabled" boolean NOT NULL,
	"r0_days" smallint NOT NULL,
	"r1_enabled" boolean NOT NULL,
	"r1_percent" smallint NOT NULL,
	"r2_enabled" boolean NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "escalation_settings_r0_days_range" CHECK ("escalation_settings"."r0_days" between 1 and 30),
	CONSTRAINT "escalation_settings_r1_percent_range" CHECK ("escalation_settings"."r1_percent" between 1 and 99)
);
--> statement-breakpoint
ALTER TABLE "escalation_recipients" ADD CONSTRAINT "escalation_recipients_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalation_recipients" ADD CONSTRAINT "escalation_recipients_position_fk" FOREIGN KEY ("tenant_id","target_position_id") REFERENCES "public"."positions"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalation_settings" ADD CONSTRAINT "escalation_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "escalation_recipients_position_unique" ON "escalation_recipients" USING btree ("tenant_id","rule","target_position_id") WHERE "escalation_recipients"."target_position_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "escalation_recipients_builtin_unique" ON "escalation_recipients" USING btree ("tenant_id","rule","target_builtin") WHERE "escalation_recipients"."target_builtin" is not null;