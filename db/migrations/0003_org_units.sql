CREATE TYPE "public"."org_unit_kinds" AS ENUM('department', 'section');--> statement-breakpoint
CREATE TABLE "org_units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" "org_unit_kinds" NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_units_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "org_units_shape" CHECK (("org_units"."kind" = 'department') = ("org_units"."parent_id" is null)),
	CONSTRAINT "org_units_name_length" CHECK ("org_units"."name" = btrim("org_units"."name") and char_length("org_units"."name") between 1 and 100)
);
--> statement-breakpoint
ALTER TABLE "tenant_members" ADD COLUMN "unit_id" uuid;--> statement-breakpoint
ALTER TABLE "org_units" ADD CONSTRAINT "org_units_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_units" ADD CONSTRAINT "org_units_parent_fk" FOREIGN KEY ("tenant_id","parent_id") REFERENCES "public"."org_units"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "org_units_department_name_unique" ON "org_units" USING btree ("tenant_id",lower("name")) WHERE "org_units"."parent_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "org_units_section_name_unique" ON "org_units" USING btree ("parent_id",lower("name")) WHERE "org_units"."parent_id" is not null;--> statement-breakpoint
ALTER TABLE "tenant_members" ADD CONSTRAINT "tenant_members_unit_fk" FOREIGN KEY ("tenant_id","unit_id") REFERENCES "public"."org_units"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tenant_members_unit_idx" ON "tenant_members" USING btree ("tenant_id","unit_id");