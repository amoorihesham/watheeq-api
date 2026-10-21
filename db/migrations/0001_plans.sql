CREATE TYPE "public"."payment_periods" AS ENUM('monthly', 'yearly');--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"user_limit" integer NOT NULL,
	"grace_days" integer NOT NULL,
	"price_halalas" bigint NOT NULL,
	"payment_period" "payment_periods" NOT NULL,
	"discount_percent" numeric(5, 2) DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plans_name_length" CHECK ("plans"."name" = btrim("plans"."name") and char_length("plans"."name") between 1 and 100),
	CONSTRAINT "plans_user_limit" CHECK ("plans"."user_limit" >= 1),
	CONSTRAINT "plans_grace_days" CHECK ("plans"."grace_days" between 0 and 365),
	CONSTRAINT "plans_price" CHECK ("plans"."price_halalas" >= 0),
	CONSTRAINT "plans_discount" CHECK ("plans"."discount_percent" between 0 and 100)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "plans_name_lower_unique" ON "plans" USING btree (lower("name"));