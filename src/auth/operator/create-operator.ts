import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { z } from "zod";
import { operators } from "../../db/schema/index.js";
import { hashPassword } from "../shared/passwords.js";

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 256;

const input = z.object({
  // The database check requires lower(btrim(email)); normalizing here keeps the CLI friendly about case.
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  password: z.string().min(MIN_PASSWORD_LENGTH).max(MAX_PASSWORD_LENGTH),
});

export class CreateOperatorError extends Error {}

/**
 * Inserts an operator. The connection must be the owner role: watheeq_app has no INSERT on operators,
 * so a compromised application cannot create operators.
 */
export async function createOperator(
  ownerConnectionString: string,
  rawEmail: string,
  password: string,
): Promise<{ id: string; email: string }> {
  const parsed = input.safeParse({ email: rawEmail, password });
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0])))];
    throw new CreateOperatorError(
      `Invalid ${fields.join(" and ")}. The password must be ${MIN_PASSWORD_LENGTH}-${MAX_PASSWORD_LENGTH} characters.`,
    );
  }
  const passwordHash = await hashPassword(parsed.data.password);

  const pool = new pg.Pool({ connectionString: ownerConnectionString, max: 1 });
  try {
    const [row] = await drizzle(pool)
      .insert(operators)
      .values({ email: parsed.data.email, passwordHash })
      .returning({ id: operators.id, email: operators.email });
    if (!row) {
      throw new Error("insert returned no row");
    }
    return row;
  } catch (err) {
    // Drizzle wraps the driver error and keeps the PostgreSQL error as `cause`.
    const pgError = (err as { cause?: { code?: string } }).cause ?? err;
    if ((pgError as { code?: string }).code === "23505") {
      throw new CreateOperatorError(`An operator with email ${parsed.data.email} already exists.`);
    }
    throw err;
  } finally {
    await pool.end();
  }
}
