import type { Router } from 'express';
import { buildRouter } from '@/http/endpoint.js';
import { createCalendarController } from './calendar.controller.js';
import { calendarApi } from './calendar.endpoints.js';
import { createCalendarRepository } from './calendar.repository.js';
import { createCalendarService } from './calendar.service.js';
import type { CalendarRouterDepsType } from './calendar.types.js';

/** The module's composition root; its router is built from `calendarApi` and mounted at its prefix. */
export function createCalendarRouter({ db, auth }: CalendarRouterDepsType): Router {
  const controller = createCalendarController({
    service: createCalendarService({ db, repo: createCalendarRepository() }),
  });
  return buildRouter(calendarApi, controller, { db, jwtSecret: auth.jwtSecret });
}
