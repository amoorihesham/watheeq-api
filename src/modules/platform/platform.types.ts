import type { AuthUserType } from "@/modules/auth/index.js";
import type { PLATFORM_PERMISSIONS } from "./permissions.js";

export type PlatformPermissionType = (typeof PLATFORM_PERMISSIONS)[number];

export type PlatformPermissionsOfType = (
  operator: AuthUserType,
) => ReadonlySet<PlatformPermissionType>;
