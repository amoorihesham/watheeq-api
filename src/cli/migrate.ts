import { runMigrations } from "../db/migrate.js";

// Reads the URL directly: validated config is for the running app, not this tool.
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

try {
  await runMigrations(url);
  console.log("migrations applied");
} catch (err) {
  console.error(err);
  process.exit(1);
}
