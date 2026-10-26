CREATE TYPE "public"."notification_kinds" AS ENUM('request.review_overdue', 'request.at_risk', 'request.breached', 'escalation.no_recipients', 'request.stage_assigned', 'request.stage_held', 'request.information_requested', 'request.information_cancelled', 'request.information_answered', 'request.accepted', 'request.handler_assigned', 'request.handler_removed', 'request.rejected', 'request.completed', 'request.closed_no_response', 'request.priority_changed', 'subscription.ending_soon', 'subscription.grace_started', 'subscription.read_only_started', 'storage.nearly_full');--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "notification_kinds" NOT NULL,
	"request_id" uuid,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	CONSTRAINT "notifications_data_object" CHECK (jsonb_typeof("notifications"."data") = 'object')
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."tenant_members"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_request_fk" FOREIGN KEY ("tenant_id","request_id") REFERENCES "public"."requests"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_list_idx" ON "notifications" USING btree ("tenant_id","user_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "notifications_unread_idx" ON "notifications" USING btree ("tenant_id","user_id") WHERE "notifications"."read_at" is null;--> statement-breakpoint
CREATE INDEX "notifications_cleanup_idx" ON "notifications" USING btree ("read_at") WHERE "notifications"."read_at" is not null;