import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AdminGuard } from './admin.guard';

function contextWithHeader(header?: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        header: (name: string) => (name === 'x-admin-key' ? header : undefined),
      }),
    }),
  } as unknown as ExecutionContext;
}

describe('AdminGuard', () => {
  const originalKey = process.env.ADMIN_API_KEY;

  afterEach(() => {
    process.env.ADMIN_API_KEY = originalKey;
  });

  it('fails closed when ADMIN_API_KEY is not configured', () => {
    delete process.env.ADMIN_API_KEY;
    const guard = new AdminGuard();
    expect(() => guard.canActivate(contextWithHeader('anything'))).toThrow(UnauthorizedException);
  });

  it('rejects a missing header', () => {
    process.env.ADMIN_API_KEY = 'secret';
    const guard = new AdminGuard();
    expect(() => guard.canActivate(contextWithHeader(undefined))).toThrow(UnauthorizedException);
  });

  it('rejects a wrong key', () => {
    process.env.ADMIN_API_KEY = 'secret';
    const guard = new AdminGuard();
    expect(() => guard.canActivate(contextWithHeader('wrong'))).toThrow(UnauthorizedException);
  });

  it('accepts the correct key', () => {
    process.env.ADMIN_API_KEY = 'secret';
    const guard = new AdminGuard();
    expect(guard.canActivate(contextWithHeader('secret'))).toBe(true);
  });
});
