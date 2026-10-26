CREATE TABLE "request_escalations" (
	"tenant_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"rule" "escalation_rules" NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"fired_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "request_escalations_pk" PRIMARY KEY("request_id","rule")
);
--> statement-breakpoint
ALTER TABLE "request_escalations" ADD CONSTRAINT "request_escalations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_escalations" ADD CONSTRAINT "request_escalations_request_fk" FOREIGN KEY ("tenant_id","request_id") REFERENCES "public"."requests"("tenant_id","id") ON DELETE no action ON UPDATE no action;