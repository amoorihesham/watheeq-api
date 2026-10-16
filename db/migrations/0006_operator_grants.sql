-- Hand-written (decisions P0.4, P0.5). Runs as watheeq_owner.
-- operators and operator_sessions are platform tables without RLS, so these grants are the only access control.
-- watheeq_app can read and update operators (login counters, deactivation) but cannot INSERT or DELETE them:
-- a compromised application must not be able to create operators. The `operator:create` CLI connects as watheeq_owner.
GRANT SELECT, UPDATE ON operators TO watheeq_app;
--> statement-breakpoint
-- Sessions are created at login and revoked or touched afterwards. No DELETE: expired rows are kept.
GRANT SELECT, INSERT, UPDATE ON operator_sessions TO watheeq_app;
