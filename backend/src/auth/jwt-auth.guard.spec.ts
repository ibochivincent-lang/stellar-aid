import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AuthenticatedUser } from './jwt.types';

function contextWithHeader(header?: string): ExecutionContext {
  const req: { header: (name: string) => string | undefined; user?: AuthenticatedUser } = {
    header: (name: string) => (name === 'authorization' ? header : undefined),
  };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

describe('JwtAuthGuard', () => {
  it('rejects a missing Authorization header', () => {
    const auth = { verify: jest.fn() } as unknown as AuthService;
    const guard = new JwtAuthGuard(auth);
    expect(() => guard.canActivate(contextWithHeader(undefined))).toThrow(UnauthorizedException);
    expect(auth.verify).not.toHaveBeenCalled();
  });

  it('rejects a non-Bearer header', () => {
    const auth = { verify: jest.fn() } as unknown as AuthService;
    const guard = new JwtAuthGuard(auth);
    expect(() => guard.canActivate(contextWithHeader('Basic abc123'))).toThrow(UnauthorizedException);
  });

  it('delegates verification to AuthService and attaches the result as req.user', () => {
    const decoded: AuthenticatedUser = { sub: 'admin', role: 'ADMIN', iat: 1, exp: 2 };
    const auth = { verify: jest.fn().mockReturnValue(decoded) } as unknown as AuthService;
    const guard = new JwtAuthGuard(auth);

    const req: { header: (name: string) => string | undefined; user?: AuthenticatedUser } = {
      header: (name: string) => (name === 'authorization' ? 'Bearer a.b.c' : undefined),
    };
    const context = {
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;

    expect(guard.canActivate(context)).toBe(true);
    expect(auth.verify).toHaveBeenCalledWith('a.b.c');
    expect(req.user).toEqual(decoded);
  });

  it('propagates AuthService.verify throwing on an invalid token', () => {
    const auth = {
      verify: jest.fn().mockImplementation(() => {
        throw new UnauthorizedException('invalid or expired token');
      }),
    } as unknown as AuthService;
    const guard = new JwtAuthGuard(auth);
    expect(() => guard.canActivate(contextWithHeader('Bearer bad-token'))).toThrow(
      'invalid or expired token',
    );
  });
});
