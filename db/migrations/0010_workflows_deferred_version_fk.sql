-- Drizzle cannot declare a deferrable foreign key. A workflow and its first version are inserted in one transaction,
-- each referencing the other, so the check waits for the commit (Phase 5 spec, 4.1).
ALTER TABLE "workflows" ALTER CONSTRAINT "workflows_current_version_fk" DEFERRABLE INITIALLY DEFERRED;
