import { z } from "zod";
import { ORG_UNIT_KINDS } from "./org.constants.js";

export const orgUnitResponseSchema = z.strictObject({
  id: z.string(),
  kind: z.enum(ORG_UNIT_KINDS),
  parentId: z.string().nullable(),
  name: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

const sectionNodeFields = {
  id: z.string(),
  name: z.string(),
  /** Active members with the manager flag; zero or more, all equal (P2.12). */
  managers: z.array(z.strictObject({ id: z.string(), userName: z.string() })),
  memberCount: z.number(),
};

const sectionNodeResponseSchema = z.strictObject(sectionNodeFields);

const departmentNodeResponseSchema = z.strictObject({
  ...sectionNodeFields,
  sections: z.array(sectionNodeResponseSchema),
});

export const orgTreeResponseSchema = z.strictObject({
  /** Members with no unit sit directly under the organization (P2.13). */
  organization: z.strictObject({ memberCount: z.number() }),
  departments: z.array(departmentNodeResponseSchema),
});
