import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';

/**
 * Restricts a route to the given roles, checked by RolesGuard against
 * TenantContextService. Example: @Roles('gym_admin', 'trainer')
 */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
