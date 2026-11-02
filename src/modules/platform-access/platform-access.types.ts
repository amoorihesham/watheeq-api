import type { AuthUserType } from '@/modules/auth/auth.types.js';
import type { PLATFORM_PERMISSIONS } from './platform-access.constants.js';

export type PlatformPermissionType = (typeof PLATFORM_PERMISSIONS)[number];

export type PlatformPermissionsOfType = (user: AuthUserType) => ReadonlySet<PlatformPermissionType>;
