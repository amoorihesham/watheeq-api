CREATE TYPE "public"."email_send_outcomes" AS ENUM('sent', 'failed');--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "invitation_email" "email_send_outcomes";