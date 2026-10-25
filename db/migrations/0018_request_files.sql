CREATE TABLE "request_files" (
	"tenant_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"file_id" uuid PRIMARY KEY NOT NULL,
	"field_id" uuid,
	"information_request_id" uuid,
	"attached_by" uuid NOT NULL,
	"attached_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "request_files_one_source" CHECK ("request_files"."field_id" is null or "request_files"."information_request_id" is null)
);
--> statement-breakpoint
ALTER TABLE "request_files" ADD CONSTRAINT "request_files_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_files" ADD CONSTRAINT "request_files_request_fk" FOREIGN KEY ("tenant_id","request_id") REFERENCES "public"."requests"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_files" ADD CONSTRAINT "request_files_file_fk" FOREIGN KEY ("tenant_id","file_id") REFERENCES "public"."files"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_files" ADD CONSTRAINT "request_files_attached_by_fk" FOREIGN KEY ("tenant_id","attached_by") REFERENCES "public"."tenant_members"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "request_files_request_idx" ON "request_files" USING btree ("request_id");