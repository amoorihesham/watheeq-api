import type { AuthUserType } from "@/modules/auth/index.js";
import type { PLATFORM_PERMISSIONS } from "./platform.config.js";

export type PlatformPermissionType = (typeof PLATFORM_PERMISSIONS)[number];

export type PlatformPermissionsOfType = (user: AuthUserType) => ReadonlySet<PlatformPermissionType>;
