ALTER TABLE "services" ADD COLUMN "form" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "form_revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_form_is_array" CHECK (jsonb_typeof("services"."form") = 'array');