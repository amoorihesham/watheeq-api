import type { Request, RequestHandler } from "express";
import { sendData, sendNoContent } from "@/http/respond.js";
import { auditContextOf } from "@/modules/auth/index.js";
import { subscriptionOf } from "@/modules/subscriptions/index.js";
import {
  calendarDaysResponseSchema,
  calendarResponseSchema,
  hoursVersionResponseSchema,
  periodResponseSchema,
} from "./calendar.responses.js";
import type { CalendarServiceType } from "./calendar.types.js";
import { toPeriodResponse } from "./shared/period-response.js";

const tenantOf = (req: Request) => subscriptionOf(req).tenantId;
const effectiveFromOf = (req: Request) => String(req.params.effectiveFrom);
const periodIdOf = (req: Request) => String(req.params.periodId);
const yearOf = (req: Request) => String(req.params.year);

export function createCalendarController({ service }: { service: CalendarServiceType }) {
  return {
    get: (async (req, res) => {
      sendData(res, 200, calendarResponseSchema, await service.get(tenantOf(req), req.query));
    }) satisfies RequestHandler,

    days: (async (req, res) => {
      sendData(res, 200, calendarDaysResponseSchema, await service.days(tenantOf(req), req.query));
    }) satisfies RequestHandler,

    setHours: (async (req, res) => {
      const version = await service.setHours(
        tenantOf(req),
        effectiveFromOf(req),
        req.body,
        auditContextOf(req),
      );
      sendData(res, 200, hoursVersionResponseSchema, version);
    }) satisfies RequestHandler,

    deleteHours: (async (req, res) => {
      await service.deleteHours(tenantOf(req), effectiveFromOf(req), auditContextOf(req));
      sendNoContent(res);
    }) satisfies RequestHandler,

    createPeriod: (async (req, res) => {
      const period = await service.create(tenantOf(req), req.body, auditContextOf(req));
      sendData(res, 201, periodResponseSchema, toPeriodResponse(period));
    }) satisfies RequestHandler,

    updatePeriod: (async (req, res) => {
      const period = await service.update(
        tenantOf(req),
        periodIdOf(req),
        req.body,
        auditContextOf(req),
      );
      sendData(res, 200, periodResponseSchema, toPeriodResponse(period));
    }) satisfies RequestHandler,

    deletePeriod: (async (req, res) => {
      await service.delete(tenantOf(req), periodIdOf(req), auditContextOf(req));
      sendNoContent(res);
    }) satisfies RequestHandler,

    setOverride: (async (req, res) => {
      const period = await service.setOverride(
        tenantOf(req),
        periodIdOf(req),
        yearOf(req),
        req.body,
        auditContextOf(req),
      );
      sendData(res, 200, periodResponseSchema, toPeriodResponse(period));
    }) satisfies RequestHandler,

    deleteOverride: (async (req, res) => {
      await service.deleteOverride(
        tenantOf(req),
        periodIdOf(req),
        yearOf(req),
        auditContextOf(req),
      );
      sendNoContent(res);
    }) satisfies RequestHandler,
  };
}
