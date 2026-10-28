import { parseCliConfig } from '../config/config.js';
import { runMigrations } from '../db/migrate.js';

const parsed = parseCliConfig(process.env);
if (!parsed.ok) {
  console.error(parsed.message);
  process.exit(1);
}

try {
  await runMigrations(parsed.config.database.url);
  console.log('migrations applied');
} catch (err) {
  console.error(err);
  process.exit(1);
}
