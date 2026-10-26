CREATE TYPE "public"."tenant_notice_kinds" AS ENUM('subscription_ending_soon', 'subscription_grace_started', 'subscription_read_only_started', 'storage_nearly_full');--> statement-breakpoint
CREATE TABLE "tenant_notices" (
	"tenant_id" uuid NOT NULL,
	"kind" "tenant_notice_kinds" NOT NULL,
	"key" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_notices_pk" PRIMARY KEY("tenant_id","kind","key")
);
--> statement-breakpoint
ALTER TABLE "tenant_notices" ADD CONSTRAINT "tenant_notices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;