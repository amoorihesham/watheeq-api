import type { Request, RequestHandler } from "express";
import { auditContextOf } from "@/modules/auth/index.js";
import { subscriptionOf } from "@/modules/subscriptions/index.js";
import type {
  CalendarDaysResponseType,
  CalendarResponseType,
  CalendarServiceType,
  HoursVersionResponseType,
} from "./calendar.types.js";

const tenantOf = (req: Request) => subscriptionOf(req).tenantId;
const effectiveFromOf = (req: Request) => String(req.params.effectiveFrom);

export function createCalendarController({ service }: { service: CalendarServiceType }) {
  return {
    get: (async (req, res) => {
      const calendar = await service.get(tenantOf(req), req.query);
      res.status(200).json(calendar satisfies CalendarResponseType);
    }) satisfies RequestHandler,

    days: (async (req, res) => {
      const days = await service.days(tenantOf(req), req.query);
      res.status(200).json(days satisfies CalendarDaysResponseType);
    }) satisfies RequestHandler,

    setHours: (async (req, res) => {
      const version = await service.setHours(
        tenantOf(req),
        effectiveFromOf(req),
        req.body,
        auditContextOf(req),
      );
      res.status(200).json({ version } satisfies HoursVersionResponseType);
    }) satisfies RequestHandler,

    deleteHours: (async (req, res) => {
      await service.deleteHours(tenantOf(req), effectiveFromOf(req), auditContextOf(req));
      res.status(204).end();
    }) satisfies RequestHandler,
  };
}
