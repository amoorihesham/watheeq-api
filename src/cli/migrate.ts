import { runMigrations } from "../db/migrate.js";

// Reads the URL directly: validated config (step 0.2) is for the running app, not this tool.
const url = process.env.MIGRATION_DATABASE_URL;
if (!url) {
  console.error("MIGRATION_DATABASE_URL is required (connect as watheeq_owner).");
  process.exit(1);
}

try {
  await runMigrations(url);
  console.log("migrations applied");
} catch (err) {
  console.error(err);
  process.exit(1);
}
