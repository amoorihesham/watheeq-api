import type { z } from "zod";
import type { Config } from "@/config/config.js";
import type { Db } from "@/db/pool.js";
import type { ORG_UNIT_KINDS } from "./org.config.js";
import type { createOrgController } from "./org.controller.js";
import type { createOrgRepository } from "./org.repository.js";
import type { createUnitRequestSchema, updateUnitRequestSchema } from "./org.schemas.js";
import type { createOrgService } from "./org.service.js";

export type OrgUnitKindType = (typeof ORG_UNIT_KINDS)[number];

/** A unit as the repository reads it and the API returns it. */
export interface OrgUnitType {
  id: string;
  kind: OrgUnitKindType;
  parentId: string | null;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewOrgUnitType {
  tenantId: string;
  kind: OrgUnitKindType;
  parentId: string | null;
  name: string;
}

export type CreateUnitRequestType = z.input<typeof createUnitRequestSchema>;
export type UpdateUnitRequestType = z.input<typeof updateUnitRequestSchema>;
export type UnitChangesType = z.output<typeof updateUnitRequestSchema>;

export interface SectionNodeType {
  id: string;
  name: string;
  memberCount: number;
}

export interface DepartmentNodeType extends SectionNodeType {
  sections: SectionNodeType[];
}

export interface GetOrgTreeResponseType {
  /** Members with no unit sit directly under the organization (P2.13). */
  organization: { memberCount: number };
  departments: DepartmentNodeType[];
}

export interface UnitResponseType {
  unit: OrgUnitType;
}

export interface OrgRouterDepsType {
  db: Db;
  config: Config;
}

export type OrgRepositoryType = ReturnType<typeof createOrgRepository>;
export type OrgServiceType = ReturnType<typeof createOrgService>;
export type OrgControllerType = ReturnType<typeof createOrgController>;
