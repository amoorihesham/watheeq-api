-- Hand-written (decisions P0.1, P0.4, P0.14). Runs as watheeq_owner.

-- user_sessions is tenant-owned: RLS on, forced for the owner too, like users.
ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE user_sessions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY user_sessions_select ON user_sessions FOR SELECT
  USING (tenant_id = app_current_tenant());
--> statement-breakpoint
CREATE POLICY user_sessions_insert ON user_sessions FOR INSERT
  WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
CREATE POLICY user_sessions_update ON user_sessions FOR UPDATE
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint

-- Sessions are created at login and revoked or touched afterwards. No DELETE: expired rows are kept.
GRANT SELECT, INSERT, UPDATE ON user_sessions TO watheeq_app;
--> statement-breakpoint

-- login_ip_throttle is platform security data without RLS, so this grant is its only access control.
GRANT SELECT, INSERT, UPDATE ON login_ip_throttle TO watheeq_app;
