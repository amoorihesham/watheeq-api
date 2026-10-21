import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { TestProject } from "vitest/node";
import { runMigrations } from "../../src/db/migrate.js";

let container: StartedPostgreSqlContainer | undefined;

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  container = await new PostgreSqlContainer("postgres:18").start();
  const databaseUrl = container.getConnectionUri();
  await runMigrations(databaseUrl);

  project.provide("databaseUrl", databaseUrl);
  return async () => {
    await container?.stop();
  };
}

declare module "vitest" {
  export interface ProvidedContext {
    /** The one database role the app, migrations, and the CLI use (T2). */
    databaseUrl: string;
  }
}
