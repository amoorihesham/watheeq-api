-- Hand-written (decisions P0.3, P0.23). Runs as watheeq_owner.
-- The two lookups that must happen before the tenant is known. They are the only RLS bypass in the system.
-- Both are owned by watheeq_auth (NOLOGIN, BYPASSRLS, bootstrapped by db/bootstrap/roles.sql), not by watheeq_owner,
-- because FORCE ROW LEVEL SECURITY applies to the owner and app_current_tenant() would raise with no tenant set.

CREATE FUNCTION auth_find_user_for_login(p_email text)
RETURNS TABLE (
  id uuid,
  tenant_id uuid,
  password_hash text,
  is_active boolean,
  failed_login_count integer,
  locked_until timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT u.id, u.tenant_id, u.password_hash, u.is_active, u.failed_login_count, u.locked_until
  FROM public.users u
  WHERE u.email = p_email
  LIMIT 1
$$;
--> statement-breakpoint

-- Returns the session and its user only if the session is valid now:
-- not revoked, not past its absolute expiry, not idle for too long, and the user is active.
CREATE FUNCTION auth_resolve_user_session(p_token_hash bytea, p_idle_timeout_seconds integer)
RETURNS TABLE (
  session_id uuid,
  tenant_id uuid,
  last_seen_at timestamptz,
  user_id uuid,
  email text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT s.id, s.tenant_id, s.last_seen_at, u.id, u.email
  FROM public.user_sessions s
  JOIN public.users u ON u.id = s.user_id AND u.tenant_id = s.tenant_id
  WHERE s.token_hash = p_token_hash
    AND s.revoked_at IS NULL
    AND s.expires_at > now()
    AND s.last_seen_at > now() - make_interval(secs => p_idle_timeout_seconds)
    AND u.is_active
  LIMIT 1
$$;
--> statement-breakpoint

-- Reading the two tables is all the function owner may do.
GRANT USAGE ON SCHEMA public TO watheeq_auth;
--> statement-breakpoint
GRANT SELECT ON users, user_sessions TO watheeq_auth;
--> statement-breakpoint

-- Changing a function's owner requires the new owner to hold CREATE on the schema.
-- Grant it for the duration of the two statements below only.
GRANT CREATE ON SCHEMA public TO watheeq_auth;
--> statement-breakpoint
ALTER FUNCTION auth_find_user_for_login(text) OWNER TO watheeq_auth;
--> statement-breakpoint
ALTER FUNCTION auth_resolve_user_session(bytea, integer) OWNER TO watheeq_auth;
--> statement-breakpoint
REVOKE CREATE ON SCHEMA public FROM watheeq_auth;
--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION auth_find_user_for_login(text) FROM PUBLIC;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION auth_resolve_user_session(bytea, integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION auth_find_user_for_login(text) TO watheeq_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION auth_resolve_user_session(bytea, integer) TO watheeq_app;
