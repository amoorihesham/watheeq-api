CREATE TYPE "public"."calendar_override_actions" AS ENUM('move', 'skip');--> statement-breakpoint
CREATE TYPE "public"."calendar_period_kinds" AS ENUM('holiday', 'season');--> statement-breakpoint
CREATE TYPE "public"."calendar_recurrences" AS ENUM('once', 'gregorian', 'hijri');--> statement-breakpoint
CREATE TABLE "calendar_period_overrides" (
	"tenant_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"action" "calendar_override_actions" NOT NULL,
	"start_date" date,
	"end_date" date,
	CONSTRAINT "calendar_period_overrides_period_id_year_pk" PRIMARY KEY("period_id","year"),
	CONSTRAINT "calendar_period_overrides_dates" CHECK (case when "calendar_period_overrides"."action" = 'move'
        then "calendar_period_overrides"."start_date" is not null and "calendar_period_overrides"."end_date" is not null and "calendar_period_overrides"."start_date" <= "calendar_period_overrides"."end_date"
        else num_nulls("calendar_period_overrides"."start_date", "calendar_period_overrides"."end_date") = 2
        end)
);
--> statement-breakpoint
CREATE TABLE "calendar_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" "calendar_period_kinds" NOT NULL,
	"name" text NOT NULL,
	"recurrence" "calendar_recurrences" NOT NULL,
	"start_date" date,
	"end_date" date,
	"start_month" smallint,
	"start_day" smallint,
	"end_month" smallint,
	"end_day" smallint,
	"week" jsonb,
	"rank" smallint,
	"valid_from" date,
	"valid_until" date,
	"replaces_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_periods_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "calendar_periods_name_length" CHECK ("calendar_periods"."name" = btrim("calendar_periods"."name") and char_length("calendar_periods"."name") between 1 and 100),
	CONSTRAINT "calendar_periods_dates" CHECK (case when "calendar_periods"."recurrence" = 'once'
        then "calendar_periods"."start_date" is not null and "calendar_periods"."end_date" is not null and "calendar_periods"."start_date" <= "calendar_periods"."end_date"
          and num_nulls("calendar_periods"."start_month", "calendar_periods"."start_day", "calendar_periods"."end_month", "calendar_periods"."end_day", "calendar_periods"."valid_from", "calendar_periods"."valid_until") = 6
        else num_nulls("calendar_periods"."start_date", "calendar_periods"."end_date") = 2
          and num_nonnulls("calendar_periods"."start_month", "calendar_periods"."start_day", "calendar_periods"."end_month", "calendar_periods"."end_day", "calendar_periods"."valid_from") = 5
          and "calendar_periods"."start_month" between 1 and 12 and "calendar_periods"."end_month" between 1 and 12
          and "calendar_periods"."start_day" between 1 and 31 and "calendar_periods"."end_day" between 1 and 31
          and ("calendar_periods"."valid_until" is null or "calendar_periods"."valid_from" <= "calendar_periods"."valid_until")
        end),
	CONSTRAINT "calendar_periods_season" CHECK (("calendar_periods"."kind" = 'season') = ("calendar_periods"."week" is not null and "calendar_periods"."rank" is not null)
        and ("calendar_periods"."week" is null or jsonb_typeof("calendar_periods"."week") = 'object')
        and ("calendar_periods"."kind" = 'season' or num_nulls("calendar_periods"."week", "calendar_periods"."rank") = 2))
);
--> statement-breakpoint
CREATE TABLE "working_hours" (
	"tenant_id" uuid NOT NULL,
	"effective_from" date NOT NULL,
	"week" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "working_hours_tenant_id_effective_from_pk" PRIMARY KEY("tenant_id","effective_from"),
	CONSTRAINT "working_hours_week_object" CHECK (jsonb_typeof("working_hours"."week") = 'object')
);
--> statement-breakpoint
ALTER TABLE "calendar_period_overrides" ADD CONSTRAINT "calendar_period_overrides_period_fk" FOREIGN KEY ("tenant_id","period_id") REFERENCES "public"."calendar_periods"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_periods" ADD CONSTRAINT "calendar_periods_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "working_hours" ADD CONSTRAINT "working_hours_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;