import type { Router } from 'express';
import type pg from 'pg';
import type { DatabaseConfigType } from '@/config/config.js';
import { buildRouter } from '@/http/endpoint.js';
import { createHealthController } from './health.controller.js';
import { healthApi } from './health.endpoints.js';
import { createHealthRepository } from './health.repository.js';

/** The health module's composition root. Takes the pool and the database group, because the ping needs its own deadline. */
export function createHealthRouter(pool: pg.Pool, { timeoutMs }: DatabaseConfigType): Router {
  const controller = createHealthController({ repo: createHealthRepository(pool, timeoutMs) });
  return buildRouter(healthApi, controller);
}
