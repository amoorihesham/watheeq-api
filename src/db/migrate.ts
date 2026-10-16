import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

const MIGRATIONS_FOLDER = fileURLToPath(new URL("../../db/migrations", import.meta.url));

/**
 * Applies pending migrations. The connection must be the owner role (`watheeq_owner`).
 * Called by `pnpm db:migrate` and by the test setup, never by the application at startup.
 */
export async function runMigrations(ownerConnectionString: string): Promise<void> {
  const pool = new pg.Pool({ connectionString: ownerConnectionString, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await pool.end();
  }
}
