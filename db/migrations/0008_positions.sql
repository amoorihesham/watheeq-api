CREATE TYPE "public"."assignee_builtins" AS ENUM('handler', 'requester', 'handler_unit_managers', 'handler_department_managers', 'requester_unit_managers', 'requester_department_managers');--> statement-breakpoint
CREATE TABLE "positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"unit_id" uuid,
	"name" text NOT NULL,
	"retired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "positions_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "positions_tenant_unit_id_unique" UNIQUE("tenant_id","unit_id","id"),
	CONSTRAINT "positions_unit_or_retired" CHECK ("positions"."unit_id" is not null or "positions"."retired_at" is not null),
	CONSTRAINT "positions_name_length" CHECK ("positions"."name" = btrim("positions"."name") and char_length("positions"."name") between 1 and 100)
);
--> statement-breakpoint
ALTER TABLE "tenant_members" ADD COLUMN "position_id" uuid;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_unit_fk" FOREIGN KEY ("tenant_id","unit_id") REFERENCES "public"."org_units"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "positions_name_unique" ON "positions" USING btree ("tenant_id",lower("name")) WHERE "positions"."retired_at" is null;--> statement-breakpoint
ALTER TABLE "tenant_members" ADD CONSTRAINT "tenant_members_position_fk" FOREIGN KEY ("tenant_id","unit_id","position_id") REFERENCES "public"."positions"("tenant_id","unit_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_members" ADD CONSTRAINT "tenant_members_position_has_unit" CHECK ("tenant_members"."position_id" is null or "tenant_members"."unit_id" is not null);