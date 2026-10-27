import { authApi } from "@/modules/auth/auth.endpoints.js";
import { calendarApi } from "@/modules/calendar/calendar.endpoints.js";
import { escalationApi } from "@/modules/escalation/escalation.endpoints.js";
import { filesApi } from "@/modules/files/files.endpoints.js";
import { healthApi } from "@/modules/health/health.endpoints.js";
import { notificationsApi } from "@/modules/notifications/notifications.endpoints.js";
import { orgApi } from "@/modules/org/org.endpoints.js";
import { plansApi } from "@/modules/platform/plans/plans.endpoints.js";
import { tenantsApi } from "@/modules/platform/tenants/tenants.endpoints.js";
import { positionsApi } from "@/modules/positions/positions.endpoints.js";
import { prioritiesApi } from "@/modules/priorities/priorities.endpoints.js";
import { requestsApi } from "@/modules/requests/requests.endpoints.js";
import { permissionsApi, rolesApi } from "@/modules/roles/roles.endpoints.js";
import { servicesApi } from "@/modules/services/services.endpoints.js";
import { subscriptionsApi } from "@/modules/subscriptions/subscriptions.endpoints.js";
import { usersApi } from "@/modules/users/users.endpoints.js";
import { workflowsApi } from "@/modules/workflows/workflows.endpoints.js";
import type { ApiType } from "./endpoint.js";

/** Every declared group, once: the document generator and the route contract test read this list. */
export const apis: readonly ApiType[] = [
  healthApi,
  authApi,
  plansApi,
  tenantsApi,
  subscriptionsApi,
  orgApi,
  usersApi,
  rolesApi,
  permissionsApi,
  calendarApi,
  positionsApi,
  workflowsApi,
  servicesApi,
  prioritiesApi,
  escalationApi,
  filesApi,
  requestsApi,
  notificationsApi,
];
