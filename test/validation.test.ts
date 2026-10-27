import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { AppError } from "../src/http/errors.js";
import { NO_FIELDS, validate } from "../src/http/validate.js";

const detailsOf = (schema: z.ZodType, input: unknown) => {
  try {
    validate(schema, input);
  } catch (err) {
    return (err as AppError).details;
  }
  throw new Error("expected validation to fail");
};

describe("validate", () => {
  const update = z
    .strictObject({ userName: z.string(), isManager: z.boolean() })
    .partial()
    .refine((body) => Object.keys(body).length > 0, NO_FIELDS);

  it("names each field a strict schema does not accept", () => {
    expect(detailsOf(update, { userName: "Khalid", roleId: "x", isManger: true })).toEqual([
      { path: "roleId", code: "unknown_field" },
      { path: "isManger", code: "unknown_field" },
    ]);
  });

  it("gives an unknown nested field its full path", () => {
    const tenant = z.strictObject({
      admin: z.strictObject({ email: z.string() }),
      grants: z.array(z.strictObject({ key: z.string() })),
    });
    expect(
      detailsOf(tenant, { admin: { email: "a", phone: "1" }, grants: [{ key: "k", note: "n" }] }),
    ).toEqual([
      { path: "admin.phone", code: "unknown_field" },
      { path: "grants.0.note", code: "unknown_field" },
    ]);
  });

  it("reports an update that changes nothing as no_fields", () => {
    expect(detailsOf(update, {})).toEqual([{ path: "", code: "no_fields" }]);
  });

  it("keeps zod's code for other problems", () => {
    expect(detailsOf(update, { isManager: "yes" })).toEqual([
      { path: "isManager", code: "invalid_type" },
    ]);
  });
});

describe("request schemas", () => {
  // Request bodies reject unknown fields (T25). Only these may accept them: token claims carry standard JWT
  // fields, and query strings carry parameters the API does not control.
  const LENIENT = [
    "tenantClaimSchema",
    "accessTokenPayloadSchema",
    "listUsersQuerySchema",
    "listPlansQuerySchema",
    "listTenantsQuerySchema",
    "listRolesQuerySchema",
    "listPermissionsQuerySchema",
    "calendarQuerySchema",
    "listPositionsQuerySchema",
    "listWorkflowsQuerySchema",
    "listServicesQuerySchema",
    "listPrioritiesQuerySchema",
    "listRequestsQuerySchema",
    "listNotificationsQuerySchema",
    "uploadQuerySchema",
    "dayViewQueryFields",
  ];

  const schemaFiles = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      return entry.isDirectory() ? schemaFiles(path) : path.endsWith(".schemas.ts") ? [path] : [];
    });

  it("are all strict objects, apart from the lenient ones", () => {
    const loose = schemaFiles("src/modules").flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .flatMap((line, index) =>
          /\.object\(/.test(line) && !LENIENT.some((name) => line.includes(name))
            ? [`${file}:${index + 1}`]
            : [],
        ),
    );
    expect(loose).toEqual([]);
  });
});
