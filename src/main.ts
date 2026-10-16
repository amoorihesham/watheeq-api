import { buildApp } from "./app.js";
import { createPool } from "./db/pool.js";

// Minimal environment reading for step 0.1. Step 0.2 replaces this with validated config.
const databaseUrl = process.env.DATABASE_URL ?? "postgres://watheeq:watheeq@localhost:5432/watheeq";
const port = Number(process.env.PORT ?? 3000);

const pool = createPool(databaseUrl);
const server = buildApp({ pool }).listen(port, () => {
  console.log(`listening on port ${port}`);
});

function shutdown(): void {
  server.close(() => {
    void pool.end().finally(() => process.exit(0));
  });
  server.closeIdleConnections();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
