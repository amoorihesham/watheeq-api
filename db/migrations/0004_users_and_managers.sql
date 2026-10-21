CREATE TYPE "public"."password_token_purposes" AS ENUM('invitation', 'reset');--> statement-breakpoint
CREATE TABLE "password_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" "password_token_purposes" NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_verifications" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "email_verifications" CASCADE;--> statement-breakpoint
ALTER TABLE "tenant_members" ADD COLUMN "is_manager" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "password_tokens" ADD CONSTRAINT "password_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "password_tokens_token_hash_unique" ON "password_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "password_tokens_user_idx" ON "password_tokens" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "tenant_members" ADD CONSTRAINT "tenant_members_manager_has_unit" CHECK (not "tenant_members"."is_manager" or "tenant_members"."unit_id" is not null);