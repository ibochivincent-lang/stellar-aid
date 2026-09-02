import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { ROLES_KEY } from './roles.decorator';

/**
 * Reads the roles `@Roles(...)` attached to the handler (or, if none,
 * falls back to the controller class) and checks them against
 * `req.user.role`, set by `JwtAuthGuard`. Must run *after* `JwtAuthGuard`
 * in `@UseGuards(JwtAuthGuard, RolesGuard)` order — it reads `req.user`,
 * it doesn't populate it.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const req = context.switchToHttp().getRequest<Request>();
    const role = req.user?.role;
    if (!role || !requiredRoles.includes(role)) {
      throw new ForbiddenException('insufficient role');
    }
    return true;
  }
}
