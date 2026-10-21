CREATE TABLE "email_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"plan_id" uuid NOT NULL,
	"plan_name" text NOT NULL,
	"user_limit" integer NOT NULL,
	"grace_days" integer NOT NULL,
	"price_halalas" bigint NOT NULL,
	"payment_period" "payment_periods" NOT NULL,
	"plan_discount_percent" numeric(5, 2) NOT NULL,
	"customer_discount_percent" numeric(5, 2) DEFAULT 0 NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_user_limit" CHECK ("subscriptions"."user_limit" >= 1),
	CONSTRAINT "subscriptions_grace_days" CHECK ("subscriptions"."grace_days" >= 0),
	CONSTRAINT "subscriptions_price" CHECK ("subscriptions"."price_halalas" >= 0),
	CONSTRAINT "subscriptions_plan_discount" CHECK ("subscriptions"."plan_discount_percent" between 0 and 100),
	CONSTRAINT "subscriptions_customer_discount" CHECK ("subscriptions"."customer_discount_percent" between 0 and 100),
	CONSTRAINT "subscriptions_period" CHECK ("subscriptions"."end_date" >= "subscriptions"."start_date")
);
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "email_verifications" ADD CONSTRAINT "email_verifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "email_verifications_token_hash_unique" ON "email_verifications" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "email_verifications_user_idx" ON "email_verifications" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_name_length" CHECK ("tenants"."name" = btrim("tenants"."name") and char_length("tenants"."name") between 1 and 100);--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_slug_format" CHECK ("tenants"."slug" ~ '^[a-z0-9-]{2,50}$');--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_verified_has_password" CHECK ("users"."email_verified_at" is null or "users"."password_hash" is not null);