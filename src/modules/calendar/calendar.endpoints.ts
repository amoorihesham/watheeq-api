import { z } from "zod";
import { defineApi, defineEndpoint } from "@/http/endpoint.js";
import { idSchema } from "@/http/validate.js";
import {
  calendarDaysResponseSchema,
  calendarResponseSchema,
  hoursVersionResponseSchema,
  periodResponseSchema,
} from "./calendar.responses.js";
import {
  calendarQuerySchema,
  createPeriodRequestSchema,
  dayViewQuerySchema,
  effectiveFromParamSchema,
  periodOverrideRequestSchema,
  updatePeriodRequestSchema,
  weekShapeSchema,
  yearParamSchema,
} from "./calendar.schemas.js";

const hoursParams = z.strictObject({ effectiveFrom: effectiveFromParamSchema });
const periodParams = z.strictObject({ periodId: idSchema });
const overrideParams = z.strictObject({ periodId: idSchema, year: yearParamSchema });

export const calendarApi = defineApi({
  tag: "calendar",
  prefix: "/calendar",
  realm: "tenant",
  endpoints: {
    get: defineEndpoint({
      method: "get",
      path: "/",
      summary: "The working hours versions, holidays, and seasons",
      permission: { tenant: "calendar.view" },
      query: calendarQuerySchema,
      response: { kind: "data", status: 200, schema: calendarResponseSchema },
    }),
    days: defineEndpoint({
      method: "get",
      path: "/days",
      summary: "Each date's Hijri date, hours, holidays, and season in a range",
      permission: { tenant: "calendar.view" },
      query: dayViewQuerySchema,
      response: { kind: "data", status: 200, schema: calendarDaysResponseSchema },
    }),
    setHours: defineEndpoint({
      method: "put",
      path: "/hours/:effectiveFrom",
      summary: "Create or replace the hours version starting on a future date",
      permission: { tenant: "calendar.manage" },
      params: hoursParams,
      body: weekShapeSchema,
      response: { kind: "data", status: 200, schema: hoursVersionResponseSchema },
      errors: ["CALENDAR_DATE_LOCKED"],
    }),
    deleteHours: defineEndpoint({
      method: "delete",
      path: "/hours/:effectiveFrom",
      summary: "Remove an hours version that is not yet in force",
      permission: { tenant: "calendar.manage" },
      params: hoursParams,
      response: { kind: "noContent" },
      errors: ["CALENDAR_DATE_LOCKED"],
    }),
    createPeriod: defineEndpoint({
      method: "post",
      path: "/periods",
      summary: "Add a holiday or a season",
      permission: { tenant: "calendar.manage" },
      body: createPeriodRequestSchema,
      response: { kind: "data", status: 201, schema: periodResponseSchema },
      errors: ["CALENDAR_DATE_LOCKED"],
    }),
    updatePeriod: defineEndpoint({
      method: "patch",
      path: "/periods/:periodId",
      summary: "Change a holiday or season for the future only",
      permission: { tenant: "calendar.manage" },
      params: periodParams,
      body: updatePeriodRequestSchema,
      response: { kind: "data", status: 200, schema: periodResponseSchema },
      errors: ["CALENDAR_DATE_LOCKED", "CALENDAR_PERIOD_ENDED"],
    }),
    deletePeriod: defineEndpoint({
      method: "delete",
      path: "/periods/:periodId",
      summary: "Remove a period that has not begun, or end one that has",
      permission: { tenant: "calendar.manage" },
      params: periodParams,
      response: { kind: "noContent" },
      errors: ["CALENDAR_DATE_LOCKED", "CALENDAR_PERIOD_ENDED"],
    }),
    setOverride: defineEndpoint({
      method: "put",
      path: "/periods/:periodId/overrides/:year",
      summary: "Move or skip one year's occurrence of a recurring period",
      permission: { tenant: "calendar.manage" },
      params: overrideParams,
      body: periodOverrideRequestSchema,
      response: { kind: "data", status: 200, schema: periodResponseSchema },
      errors: ["CALENDAR_DATE_LOCKED", "CALENDAR_PERIOD_ENDED"],
    }),
    deleteOverride: defineEndpoint({
      method: "delete",
      path: "/periods/:periodId/overrides/:year",
      summary: "Return one year's occurrence to the rule",
      permission: { tenant: "calendar.manage" },
      params: overrideParams,
      response: { kind: "noContent" },
      errors: ["CALENDAR_DATE_LOCKED", "CALENDAR_PERIOD_ENDED"],
    }),
  },
});
