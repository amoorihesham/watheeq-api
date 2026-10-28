import type { HandlerOf } from '@/http/endpoint.js';
import { AppError } from '@/http/errors.js';
import type { healthApi } from './health.endpoints.js';
import type { HealthRepositoryType } from './health.types.js';

/** No service layer: there is no business rule between the request and the database ping. */
export function createHealthController({ repo }: { repo: HealthRepositoryType }) {
  return {
    health: (async () => {
      if (!(await repo.isDbUp())) {
        throw new AppError('SERVICE_UNAVAILABLE');
      }
      return { status: 'ok', db: 'up' } as const;
    }) satisfies HandlerOf<typeof healthApi.endpoints.health>,
  };
}
