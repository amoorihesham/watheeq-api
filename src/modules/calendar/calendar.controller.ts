import type { Request } from "express";
import type { HandlerOf } from "@/http/endpoint.js";
import { auditContextOf } from "@/modules/auth/index.js";
import { subscriptionOf } from "@/modules/subscriptions/index.js";
import type { calendarApi } from "./calendar.endpoints.js";
import type { CalendarServiceType } from "./calendar.types.js";
import { toPeriodResponse } from "./shared/period-response.js";

const tenantOf = (req: Request) => subscriptionOf(req).tenantId;

export function createCalendarController({ service }: { service: CalendarServiceType }) {
  return {
    get: (async ({ query }, req) => service.get(tenantOf(req), query)) satisfies HandlerOf<
      typeof calendarApi.endpoints.get
    >,

    days: (async ({ query }, req) => service.days(tenantOf(req), query)) satisfies HandlerOf<
      typeof calendarApi.endpoints.days
    >,

    setHours: (async ({ params, body }, req) =>
      service.setHours(
        tenantOf(req),
        params.effectiveFrom,
        body,
        auditContextOf(req),
      )) satisfies HandlerOf<typeof calendarApi.endpoints.setHours>,

    deleteHours: (async ({ params }, req) => {
      await service.deleteHours(tenantOf(req), params.effectiveFrom, auditContextOf(req));
    }) satisfies HandlerOf<typeof calendarApi.endpoints.deleteHours>,

    createPeriod: (async ({ body }, req) =>
      toPeriodResponse(
        await service.create(tenantOf(req), body, auditContextOf(req)),
      )) satisfies HandlerOf<typeof calendarApi.endpoints.createPeriod>,

    updatePeriod: (async ({ params, body }, req) =>
      toPeriodResponse(
        await service.update(tenantOf(req), params.periodId, body, auditContextOf(req)),
      )) satisfies HandlerOf<typeof calendarApi.endpoints.updatePeriod>,

    deletePeriod: (async ({ params }, req) => {
      await service.delete(tenantOf(req), params.periodId, auditContextOf(req));
    }) satisfies HandlerOf<typeof calendarApi.endpoints.deletePeriod>,

    setOverride: (async ({ params, body }, req) =>
      toPeriodResponse(
        await service.setOverride(
          tenantOf(req),
          params.periodId,
          params.year,
          body,
          auditContextOf(req),
        ),
      )) satisfies HandlerOf<typeof calendarApi.endpoints.setOverride>,

    deleteOverride: (async ({ params }, req) => {
      await service.deleteOverride(
        tenantOf(req),
        params.periodId,
        params.year,
        auditContextOf(req),
      );
    }) satisfies HandlerOf<typeof calendarApi.endpoints.deleteOverride>,
  };
}
