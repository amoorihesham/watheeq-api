import type { z } from "zod";
import type { AuthConfigType } from "@/config/config.js";
import type { Db } from "@/db/pool.js";
import type { ORG_UNIT_KINDS } from "./org.constants.js";
import type { createOrgController } from "./org.controller.js";
import type { createOrgRepository } from "./org.repository.js";
import type { orgTreeResponseSchema, orgUnitResponseSchema } from "./org.responses.js";
import type { createUnitRequestSchema, updateUnitRequestSchema } from "./org.schemas.js";
import type { createOrgService } from "./org.service.js";

export type OrgUnitKindType = (typeof ORG_UNIT_KINDS)[number];

/** A unit as the repository reads it and the API returns it. */
export type OrgUnitType = z.output<typeof orgUnitResponseSchema>;

export interface NewOrgUnitType {
  tenantId: string;
  kind: OrgUnitKindType;
  parentId: string | null;
  name: string;
}

export type CreateUnitRequestType = z.input<typeof createUnitRequestSchema>;
export type UpdateUnitRequestType = z.input<typeof updateUnitRequestSchema>;
export type UnitChangesType = z.output<typeof updateUnitRequestSchema>;

export type OrgTreeResponseType = z.output<typeof orgTreeResponseSchema>;

export interface OrgRouterDepsType {
  db: Db;
  auth: AuthConfigType;
}

export type OrgRepositoryType = ReturnType<typeof createOrgRepository>;
export type OrgServiceType = ReturnType<typeof createOrgService>;
export type OrgControllerType = ReturnType<typeof createOrgController>;
