import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const userRoles = pgEnum("user_roles", ["user", "operator"]);

export const users = pgTable(
  "users",
  {
    id: uuid().primaryKey().defaultRandom(),
    email: text().notNull(),
    // The person's display name, for example "Sara Al-Qahtani". Not unique; login is by email.
    userName: text("user_name").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: userRoles().notNull().default("user"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("users_email_unique").on(t.email),
    // Without this, "Sara@AlNoor.com.sa" could be stored next to "sara@alnoor.com.sa" and slip past the unique index.
    check("users_email_normalized", sql`${t.email} = lower(btrim(${t.email}))`),
    check(
      "users_user_name_length",
      sql`${t.userName} = btrim(${t.userName}) and char_length(${t.userName}) between 1 and 100`,
    ),
  ],
);
