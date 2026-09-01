import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AdminGuard } from './admin.guard';

function contextWithHeader(header: string | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        header: (name: string) =>
          name === 'x-admin-key' ? header : undefined,
      }),
    }),
  } as unknown as ExecutionContext;
}

describe('AdminGuard', () => {
  const originalKey = process.env.ADMIN_API_KEY;

  afterEach(() => {
    process.env.ADMIN_API_KEY = originalKey;
  });

  it('rejects when ADMIN_API_KEY is not configured, even with a header sent', () => {
    delete process.env.ADMIN_API_KEY;
    const guard = new AdminGuard();
    expect(() => guard.canActivate(contextWithHeader('anything'))).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a missing x-admin-key header', () => {
    process.env.ADMIN_API_KEY = 'secret';
    const guard = new AdminGuard();
    expect(() => guard.canActivate(contextWithHeader(undefined))).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a wrong x-admin-key header', () => {
    process.env.ADMIN_API_KEY = 'secret';
    const guard = new AdminGuard();
    expect(() => guard.canActivate(contextWithHeader('wrong'))).toThrow(
      UnauthorizedException,
    );
  });

  it('allows a matching x-admin-key header', () => {
    process.env.ADMIN_API_KEY = 'secret';
    const guard = new AdminGuard();
    expect(guard.canActivate(contextWithHeader('secret'))).toBe(true);
  });
});
