import type { z } from 'zod';
import type { AuthConfigType } from '@/config/config.js';
import type { Db } from '@/db/pool.js';
import type { createPrioritiesController } from './priorities.controller.js';
import type { createPrioritiesRepository } from './priorities.repository.js';
import type { priorityResponseSchema } from './priorities.responses.js';
import type { createPriorityRequestSchema, listPrioritiesQuerySchema, reorderPrioritiesRequestSchema, updatePriorityRequestSchema } from './priorities.schemas.js';
import type { createPrioritiesService } from './priorities.service.js';

export interface PriorityRowType {
  id: string;
  name: string;
  days: number;
  retiredAt: Date | null;
}

export type CreatePriorityRequestType = z.output<typeof createPriorityRequestSchema>;
export type UpdatePriorityRequestType = z.output<typeof updatePriorityRequestSchema>;
export type ReorderPrioritiesRequestType = z.output<typeof reorderPrioritiesRequestSchema>;
export type ListPrioritiesQueryType = z.output<typeof listPrioritiesQuerySchema>;

export type PriorityType = z.output<typeof priorityResponseSchema>;

export interface PrioritiesRouterDepsType {
  db: Db;
  auth: AuthConfigType;
}

export type PrioritiesRepositoryType = ReturnType<typeof createPrioritiesRepository>;
export type PrioritiesServiceType = ReturnType<typeof createPrioritiesService>;
export type PrioritiesControllerType = ReturnType<typeof createPrioritiesController>;
