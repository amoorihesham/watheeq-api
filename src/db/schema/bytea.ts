import { customType } from "drizzle-orm/pg-core";

/** PostgreSQL `bytea`, read and written as a Node Buffer. Used for token hashes. */
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});
