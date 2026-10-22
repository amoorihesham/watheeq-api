import type { Request, RequestHandler } from "express";
import { auditContextOf } from "@/modules/auth/index.js";
import { subscriptionOf } from "@/modules/subscriptions/index.js";
import type {
  CalendarDaysResponseType,
  CalendarResponseType,
  CalendarServiceType,
  HoursVersionResponseType,
  PeriodResponseType,
} from "./calendar.types.js";

const tenantOf = (req: Request) => subscriptionOf(req).tenantId;
const effectiveFromOf = (req: Request) => String(req.params.effectiveFrom);
const periodIdOf = (req: Request) => String(req.params.periodId);
const yearOf = (req: Request) => String(req.params.year);

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

    createPeriod: (async (req, res) => {
      const period = await service.create(tenantOf(req), req.body, auditContextOf(req));
      res.status(201).json({ period } satisfies PeriodResponseType);
    }) satisfies RequestHandler,

    updatePeriod: (async (req, res) => {
      const period = await service.update(
        tenantOf(req),
        periodIdOf(req),
        req.body,
        auditContextOf(req),
      );
      res.status(200).json({ period } satisfies PeriodResponseType);
    }) satisfies RequestHandler,

    deletePeriod: (async (req, res) => {
      await service.delete(tenantOf(req), periodIdOf(req), auditContextOf(req));
      res.status(204).end();
    }) satisfies RequestHandler,

    setOverride: (async (req, res) => {
      const period = await service.setOverride(
        tenantOf(req),
        periodIdOf(req),
        yearOf(req),
        req.body,
        auditContextOf(req),
      );
      res.status(200).json({ period } satisfies PeriodResponseType);
    }) satisfies RequestHandler,

    deleteOverride: (async (req, res) => {
      await service.deleteOverride(
        tenantOf(req),
        periodIdOf(req),
        yearOf(req),
        auditContextOf(req),
      );
      res.status(204).end();
    }) satisfies RequestHandler,
  };
}
