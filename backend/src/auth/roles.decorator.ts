import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';

/**
 * Marks an endpoint as requiring one of the given roles. Must be paired
 * with `@UseGuards(JwtAuthGuard, RolesGuard)` — this decorator only
 * attaches metadata for `RolesGuard` to read, it enforces nothing on its
 * own (an endpoint with `@Roles(...)` but no `RolesGuard` is wide open).
 */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
