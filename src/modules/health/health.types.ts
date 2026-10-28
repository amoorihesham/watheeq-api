import type { createHealthController } from './health.controller.js';
import type { createHealthRepository } from './health.repository.js';

export type HealthRepositoryType = ReturnType<typeof createHealthRepository>;
export type HealthControllerType = ReturnType<typeof createHealthController>;
