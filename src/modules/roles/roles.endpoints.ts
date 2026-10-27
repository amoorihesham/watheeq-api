import { z } from "zod";
import { defineApi, defineEndpoint } from "@/http/endpoint.js";
import { idSchema } from "@/http/validate.js";
import { permissionResponseSchema, roleResponseSchema } from "./roles.responses.js";
import {
  createRoleRequestSchema,
  listPermissionsQuerySchema,
  listRolesQuerySchema,
  updateRoleRequestSchema,
} from "./roles.schemas.js";

const roleParams = z.strictObject({ roleId: idSchema });

export const rolesApi = defineApi({
  tag: "roles",
  prefix: "/roles",
  realm: "tenant",
  endpoints: {
    list: defineEndpoint({
      method: "get",
      path: "/",
      summary: "List the tenant's roles",
      permission: { tenant: "role.view" },
      query: listRolesQuerySchema,
      response: { kind: "page", schema: roleResponseSchema },
    }),
    get: defineEndpoint({
      method: "get",
      path: "/:roleId",
      summary: "One role with its permissions",
      permission: { tenant: "role.view" },
      params: roleParams,
      response: { kind: "data", status: 200, schema: roleResponseSchema },
    }),
    create: defineEndpoint({
      method: "post",
      path: "/",
      summary: "Create a role under the subset rule",
      permission: { tenant: "role.manage" },
      body: createRoleRequestSchema,
      response: { kind: "data", status: 201, schema: roleResponseSchema },
      errors: ["TAKEN", "PERMISSION_NOT_HELD"],
    }),
    update: defineEndpoint({
      method: "patch",
      path: "/:roleId",
      summary: "Rename a role or replace its permissions",
      permission: { tenant: "role.manage" },
      params: roleParams,
      body: updateRoleRequestSchema,
      response: { kind: "data", status: 200, schema: roleResponseSchema },
      errors: ["TAKEN", "PERMISSION_NOT_HELD", "ROLE_PROTECTED"],
    }),
    delete: defineEndpoint({
      method: "delete",
      path: "/:roleId",
      summary: "Delete a role nobody holds",
      permission: { tenant: "role.manage" },
      params: roleParams,
      response: { kind: "noContent" },
      errors: ["PERMISSION_NOT_HELD", "ROLE_IN_USE", "ROLE_PROTECTED"],
    }),
  },
});

export const permissionsApi = defineApi({
  tag: "roles",
  prefix: "/permissions",
  realm: "tenant",
  endpoints: {
    list: defineEndpoint({
      method: "get",
      path: "/",
      summary: "The permission catalog roles are built from",
      permission: { tenant: "role.view" },
      query: listPermissionsQuerySchema,
      response: { kind: "page", schema: permissionResponseSchema },
    }),
  },
});
