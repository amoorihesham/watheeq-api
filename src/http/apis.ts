import { authApi } from "@/modules/auth/auth.endpoints.js";
import { filesApi } from "@/modules/files/files.endpoints.js";
import { healthApi } from "@/modules/health/health.endpoints.js";
import { notificationsApi } from "@/modules/notifications/notifications.endpoints.js";
import { requestsApi } from "@/modules/requests/requests.endpoints.js";
import type { ApiType } from "./endpoint.js";

/** Every declared group, once: the document generator and the route contract test read this list. */
export const apis: readonly ApiType[] = [
  healthApi,
  authApi,
  filesApi,
  requestsApi,
  notificationsApi,
];
