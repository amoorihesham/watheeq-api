CREATE TABLE "priorities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"days" smallint NOT NULL,
	"sort_order" smallint,
	"retired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "priorities_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "priorities_sort_order_unique" UNIQUE("tenant_id","sort_order"),
	CONSTRAINT "priorities_days_range" CHECK ("priorities"."days" between 1 and 365),
	CONSTRAINT "priorities_name_length" CHECK ("priorities"."name" = btrim("priorities"."name") and char_length("priorities"."name") between 1 and 100),
	CONSTRAINT "priorities_order_iff_active" CHECK (("priorities"."retired_at" is null) = ("priorities"."sort_order" is not null))
);
--> statement-breakpoint
CREATE TABLE "service_workflows" (
	"tenant_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"workflow_id" uuid NOT NULL,
	"is_default" boolean NOT NULL,
	CONSTRAINT "service_workflows_pk" PRIMARY KEY("service_id","workflow_id")
);
--> statement-breakpoint
CREATE TABLE "services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"retired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "services_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "services_name_length" CHECK ("services"."name" = btrim("services"."name") and char_length("services"."name") between 1 and 100),
	CONSTRAINT "services_description_length" CHECK ("services"."description" is null or char_length("services"."description") <= 2000)
);
--> statement-breakpoint
ALTER TABLE "priorities" ADD CONSTRAINT "priorities_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_workflows" ADD CONSTRAINT "service_workflows_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_workflows" ADD CONSTRAINT "service_workflows_service_fk" FOREIGN KEY ("tenant_id","service_id") REFERENCES "public"."services"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_workflows" ADD CONSTRAINT "service_workflows_workflow_fk" FOREIGN KEY ("tenant_id","workflow_id") REFERENCES "public"."workflows"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "priorities_name_unique" ON "priorities" USING btree ("tenant_id",lower("name")) WHERE "priorities"."retired_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "service_workflows_one_default" ON "service_workflows" USING btree ("service_id") WHERE "service_workflows"."is_default";--> statement-breakpoint
CREATE INDEX "service_workflows_workflow_idx" ON "service_workflows" USING btree ("workflow_id");--> statement-breakpoint
CREATE UNIQUE INDEX "services_name_unique" ON "services" USING btree ("tenant_id",lower("name")) WHERE "services"."retired_at" is null;