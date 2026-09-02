import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { AuthenticatedUser } from './jwt.types';

function contextWithUserAndRoles(
  user: AuthenticatedUser | undefined,
  requiredRoles: string[] | undefined,
): { context: ExecutionContext; reflector: Reflector } {
  const req = { user };
  const context = {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(requiredRoles),
  } as unknown as Reflector;
  return { context, reflector };
}

describe('RolesGuard', () => {
  it('allows the request through when no roles are required', () => {
    const { context, reflector } = contextWithUserAndRoles(undefined, undefined);
    const guard = new RolesGuard(reflector);
    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows a request whose user has a required role', () => {
    const { context, reflector } = contextWithUserAndRoles(
      { sub: 'admin', role: 'ADMIN', iat: 1, exp: 2 },
      ['ADMIN'],
    );
    const guard = new RolesGuard(reflector);
    expect(guard.canActivate(context)).toBe(true);
  });

  it('rejects a request whose user lacks a required role', () => {
    const { context, reflector } = contextWithUserAndRoles(
      { sub: 'someone', role: 'AUDITOR', iat: 1, exp: 2 },
      ['ADMIN'],
    );
    const guard = new RolesGuard(reflector);
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('rejects when there is no authenticated user at all', () => {
    const { context, reflector } = contextWithUserAndRoles(undefined, ['ADMIN']);
    const guard = new RolesGuard(reflector);
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
