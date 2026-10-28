import type { z } from 'zod';
import type { AuthConfigType } from '@/config/config.js';
import type { Db } from '@/db/pool.js';
import type { createServicesController } from './services.controller.js';
import type { createServicesRepository } from './services.repository.js';
import type { serviceResponseSchema } from './services.responses.js';
import type { createServiceRequestSchema, listServicesQuerySchema, updateServiceFormRequestSchema, updateServiceRequestSchema } from './services.schemas.js';
import type { createServicesService } from './services.service.js';
import type { FormFieldType } from './shared/form.js';

export interface ServiceRowType {
  id: string;
  name: string;
  description: string | null;
  retiredAt: Date | null;
  form: FormFieldType[];
  formRevision: number;
}

/** A workflow a service allows, with the workflow's name and state. */
export interface AllowedWorkflowRowType {
  serviceId: string;
  id: string;
  name: string;
  isDefault: boolean;
  retiredAt: Date | null;
}

/** A workflow as a service save reads it under a share lock. */
export interface WorkflowStateRowType {
  id: string;
  retiredAt: Date | null;
}

export type CreateServiceRequestType = z.output<typeof createServiceRequestSchema>;
export type UpdateServiceRequestType = z.output<typeof updateServiceRequestSchema>;
export type UpdateServiceFormRequestType = z.output<typeof updateServiceFormRequestSchema>;
export type RequestedFieldType = z.output<typeof updateServiceFormRequestSchema>['fields'][number];
export type ListServicesQueryType = z.output<typeof listServicesQuerySchema>;
export type WorkflowChoiceType = z.output<typeof createServiceRequestSchema>['workflows'][number];

export type ServiceType = z.output<typeof serviceResponseSchema>;

export interface ServicesRouterDepsType {
  db: Db;
  auth: AuthConfigType;
}

export type ServicesRepositoryType = ReturnType<typeof createServicesRepository>;
export type ServicesServiceType = ReturnType<typeof createServicesService>;
export type ServicesControllerType = ReturnType<typeof createServicesController>;
