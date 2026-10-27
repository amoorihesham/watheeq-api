import { authApi } from "@/modules/auth/auth.endpoints.js";
import { healthApi } from "@/modules/health/health.endpoints.js";
import type { ApiType } from "./endpoint.js";

/** Every declared group, once: the document generator and the route contract test read this list. */
export const apis: readonly ApiType[] = [healthApi, authApi];
