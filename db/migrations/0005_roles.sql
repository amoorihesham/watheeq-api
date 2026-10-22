CREATE TYPE "public"."permission_scopes" AS ENUM('own', 'section', 'department', 'organization');--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"tenant_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"permission" text NOT NULL,
	"scope" "permission_scopes" NOT NULL,
	CONSTRAINT "role_permissions_role_id_permission_pk" PRIMARY KEY("role_id","permission"),
	CONSTRAINT "role_permissions_key_format" CHECK ("role_permissions"."permission" ~ '^[a-z_]+\.[a-z_]+$')
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roles_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "roles_name_length" CHECK ("roles"."name" = btrim("roles"."name") and char_length("roles"."name") between 1 and 100)
);
--> statement-breakpoint
ALTER TABLE "tenant_members" ADD COLUMN "role_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_fk" FOREIGN KEY ("tenant_id","role_id") REFERENCES "public"."roles"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "roles_name_unique" ON "roles" USING btree ("tenant_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "roles_system_unique" ON "roles" USING btree ("tenant_id") WHERE "roles"."is_system";--> statement-breakpoint
ALTER TABLE "tenant_members" ADD CONSTRAINT "tenant_members_role_fk" FOREIGN KEY ("tenant_id","role_id") REFERENCES "public"."roles"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tenant_members_role_idx" ON "tenant_members" USING btree ("tenant_id","role_id");--> statement-breakpoint
ALTER TABLE "tenant_members" DROP COLUMN "role";--> statement-breakpoint
DROP TYPE "public"."tenant_member_roles";