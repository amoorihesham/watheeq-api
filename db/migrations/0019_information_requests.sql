CREATE TYPE "public"."information_asked_in" AS ENUM('review', 'execution');--> statement-breakpoint
CREATE TYPE "public"."information_request_states" AS ENUM('open', 'answered', 'cancelled', 'closed');--> statement-breakpoint
CREATE TABLE "information_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"asked_by" uuid NOT NULL,
	"asked_in" "information_asked_in" NOT NULL,
	"question" text NOT NULL,
	"asked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"state" "information_request_states" DEFAULT 'open' NOT NULL,
	"answer" text,
	"ended_at" timestamp with time zone,
	"ended_by" uuid,
	CONSTRAINT "information_requests_request_id_unique" UNIQUE("tenant_id","request_id","id"),
	CONSTRAINT "information_requests_question_length" CHECK (char_length("information_requests"."question") between 1 and 4000),
	CONSTRAINT "information_requests_answer_length" CHECK ("information_requests"."answer" is null or char_length("information_requests"."answer") between 1 and 10000),
	CONSTRAINT "information_requests_answered" CHECK (("information_requests"."state" = 'answered') = ("information_requests"."answer" is not null)),
	CONSTRAINT "information_requests_ended" CHECK (("information_requests"."state" <> 'open') = ("information_requests"."ended_at" is not null and "information_requests"."ended_by" is not null))
);
--> statement-breakpoint
ALTER TABLE "information_requests" ADD CONSTRAINT "information_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "information_requests" ADD CONSTRAINT "information_requests_request_fk" FOREIGN KEY ("tenant_id","request_id") REFERENCES "public"."requests"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "information_requests" ADD CONSTRAINT "information_requests_asked_by_fk" FOREIGN KEY ("tenant_id","asked_by") REFERENCES "public"."tenant_members"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "information_requests" ADD CONSTRAINT "information_requests_ended_by_fk" FOREIGN KEY ("tenant_id","ended_by") REFERENCES "public"."tenant_members"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "information_requests_one_open" ON "information_requests" USING btree ("request_id") WHERE "information_requests"."state" = 'open';--> statement-breakpoint
CREATE INDEX "information_requests_request_idx" ON "information_requests" USING btree ("request_id");--> statement-breakpoint
ALTER TABLE "request_files" ADD CONSTRAINT "request_files_information_request_fk" FOREIGN KEY ("tenant_id","request_id","information_request_id") REFERENCES "public"."information_requests"("tenant_id","request_id","id") ON DELETE no action ON UPDATE no action;