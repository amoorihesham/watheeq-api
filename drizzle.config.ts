import { defineConfig } from 'drizzle-kit';

// Used by `pnpm db:generate` only. Migrations are applied by src/cli/migrate.ts (`pnpm db:migrate`).
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema',
  out: './db/migrations',
});
