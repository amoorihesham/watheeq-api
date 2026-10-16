-- One-time bootstrap, run by a database administrator (superuser) against the application database.
-- Docker Compose runs it through /docker-entrypoint-initdb.d, and the test setup runs it on its container.
-- It is idempotent. Migrations assume these roles exist (decision P0.8).
--
-- The passwords below are for local development and tests only.
-- In any real environment, create the roles with real secrets instead of running this file as is.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'watheeq_owner') THEN
    CREATE ROLE watheeq_owner LOGIN PASSWORD 'watheeq_owner'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'watheeq_app') THEN
    CREATE ROLE watheeq_app LOGIN PASSWORD 'watheeq_app'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END $$;

-- The owner role owns the schema (so it can create tables there) and may create the "drizzle" migration schema.
ALTER SCHEMA public OWNER TO watheeq_owner;
DO $$
BEGIN
  EXECUTE format('GRANT CONNECT, CREATE ON DATABASE %I TO watheeq_owner', current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO watheeq_app', current_database());
END $$;

-- The app role can see objects in the schema, and nothing more until migrations grant it table privileges.
GRANT USAGE ON SCHEMA public TO watheeq_app;
