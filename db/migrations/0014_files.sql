CREATE TYPE "public"."file_states" AS ENUM('uploading', 'pending', 'attached', 'discarded');--> statement-breakpoint
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"state" "file_states" NOT NULL,
	"name" text NOT NULL,
	"content_type" text,
	"size_bytes" integer NOT NULL,
	"sha256" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attached_at" timestamp with time zone,
	CONSTRAINT "files_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "files_attached_at" CHECK (("files"."state" = 'attached') = ("files"."attached_at" is not null)),
	CONSTRAINT "files_detected" CHECK ("files"."state" = 'uploading' or ("files"."content_type" is not null and "files"."sha256" is not null)),
	CONSTRAINT "files_size" CHECK ("files"."size_bytes" between 1 and 26214400),
	CONSTRAINT "files_name_length" CHECK (char_length("files"."name") between 1 and 255)
);
--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "storage_limit_gb" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "storage_limit_gb" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "files_cleanup_idx" ON "files" USING btree ("state","created_at") WHERE "files"."state" <> 'attached';--> statement-breakpoint
CREATE INDEX "files_uploader_idx" ON "files" USING btree ("uploaded_by") WHERE "files"."state" <> 'attached';--> statement-breakpoint
CREATE INDEX "files_tenant_idx" ON "files" USING btree ("tenant_id");--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_storage_limit" CHECK ("plans"."storage_limit_gb" between 1 and 100000);--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_storage_limit" CHECK ("subscriptions"."storage_limit_gb" between 1 and 100000);