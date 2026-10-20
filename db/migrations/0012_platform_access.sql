-- Hand-written (Phase 1 spec 4.1, decisions P1.1, P1.2). Runs as watheeq_owner.

CREATE FUNCTION app_platform_context() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('app.platform', true), '') = 'on'
$$;
--> statement-breakpoint

-- CASE evaluates its branches in order, so a platform transaction never calls app_current_tenant(),
-- and a tenant transaction without a tenant still raises (R0.8).
CREATE FUNCTION app_row_visible(row_tenant uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN app_platform_context() THEN true
    ELSE row_tenant = app_current_tenant()
  END
$$;
--> statement-breakpoint

DROP POLICY tenants_select ON tenants;
--> statement-breakpoint
CREATE POLICY tenants_select ON tenants FOR SELECT
  USING (app_row_visible(id));
--> statement-breakpoint
CREATE POLICY tenants_insert ON tenants FOR INSERT
  WITH CHECK (app_platform_context());
--> statement-breakpoint
GRANT INSERT ON tenants TO watheeq_app;
--> statement-breakpoint

DROP POLICY users_select ON users;
--> statement-breakpoint
DROP POLICY users_insert ON users;
--> statement-breakpoint
DROP POLICY users_update ON users;
--> statement-breakpoint
CREATE POLICY users_select ON users FOR SELECT
  USING (app_row_visible(tenant_id));
--> statement-breakpoint
CREATE POLICY users_insert ON users FOR INSERT
  WITH CHECK (app_row_visible(tenant_id));
--> statement-breakpoint
CREATE POLICY users_update ON users FOR UPDATE
  USING (app_row_visible(tenant_id))
  WITH CHECK (app_row_visible(tenant_id));
--> statement-breakpoint

-- audit_log stays append-only: no UPDATE or DELETE privilege or policy (T15).
DROP POLICY audit_log_select ON audit_log;
--> statement-breakpoint
DROP POLICY audit_log_insert ON audit_log;
--> statement-breakpoint
CREATE POLICY audit_log_select ON audit_log FOR SELECT
  USING (app_row_visible(tenant_id));
--> statement-breakpoint
CREATE POLICY audit_log_insert ON audit_log FOR INSERT
  WITH CHECK (app_row_visible(tenant_id));
