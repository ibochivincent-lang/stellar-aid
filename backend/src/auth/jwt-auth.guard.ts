import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { AuthenticatedUser } from './jwt.types';

/** Augments Express's Request with the decoded token, once JwtAuthGuard has run. */
declare module 'express' {
  interface Request {
    user?: AuthenticatedUser;
  }
}

/**
 * Verifies a `Bearer <token>` on `Authorization` and attaches the decoded
 * claims to `req.user` for `RolesGuard` (and handlers) to read. Pair with
 * `RolesGuard` + `@Roles(...)` — this guard only proves the caller has a
 * valid, unexpired token, not that they're allowed to hit this specific
 * endpoint.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const header = req.header('authorization');
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('missing bearer token');
    }
    const token = header.slice('Bearer '.length).trim();
    req.user = this.auth.verify(token);
    return true;
  }
}
