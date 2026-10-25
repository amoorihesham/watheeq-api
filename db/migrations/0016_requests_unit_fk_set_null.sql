-- Drizzle cannot declare `on delete set null (column)`. A deleted unit clears only the request's unit column, never
-- tenant_id, so a unit that holds old requests can still be deleted (Phase 6 spec, 4.1).
ALTER TABLE "requests" DROP CONSTRAINT "requests_requester_unit_fk";--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_requester_unit_fk" FOREIGN KEY ("tenant_id","requester_unit_id") REFERENCES "public"."org_units"("tenant_id","id") ON DELETE SET NULL ("requester_unit_id");--> statement-breakpoint
ALTER TABLE "requests" DROP CONSTRAINT "requests_handler_unit_fk";--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_handler_unit_fk" FOREIGN KEY ("tenant_id","handler_unit_id") REFERENCES "public"."org_units"("tenant_id","id") ON DELETE SET NULL ("handler_unit_id");
