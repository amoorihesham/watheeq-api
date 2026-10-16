import { readFile } from "node:fs/promises";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";
import type { TestProject } from "vitest/node";
import { runMigrations } from "../../src/db/migrate.js";

let container: StartedPostgreSqlContainer | undefined;

function urlFor(adminUrl: string, user: string, password: string): string {
  const url = new URL(adminUrl);
  url.username = user;
  url.password = password;
  return url.toString();
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  container = await new PostgreSqlContainer("postgres:18").start();
  const adminUrl = container.getConnectionUri();

  // 1. Bootstrap roles as the container superuser (what a DBA or the Compose init hook does).
  const bootstrapSql = await readFile(
    new URL("../../db/bootstrap/roles.sql", import.meta.url),
    "utf8",
  );
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(bootstrapSql);
  } finally {
    await admin.end();
  }

  // 2. Migrate as the owner role. 3. Tests connect as the runtime role.
  const ownerUrl = urlFor(adminUrl, "watheeq_owner", "watheeq_owner");
  await runMigrations(ownerUrl);

  project.provide("databaseUrl", urlFor(adminUrl, "watheeq_app", "watheeq_app"));
  project.provide("adminDatabaseUrl", adminUrl);
  project.provide("ownerDatabaseUrl", ownerUrl);
  return async () => {
    await container?.stop();
  };
}

declare module "vitest" {
  export interface ProvidedContext {
    /** Runtime role (`watheeq_app`): what the application uses. */
    databaseUrl: string;
    /** Owner role (`watheeq_owner`): what migrations and `operator:create` use. */
    ownerDatabaseUrl: string;
    /** Container superuser: test fixtures only (it bypasses RLS, which FORCE applies to the owner role). */
    adminDatabaseUrl: string;
  }
}
