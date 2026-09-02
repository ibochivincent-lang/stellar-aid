import { CallHandler, ExecutionContext } from '@nestjs/common';
import { of } from 'rxjs';
import { IdempotencyInterceptor } from './idempotency.interceptor';
import { PrismaService } from './prisma.service';

function contextWithHeader(key: string | undefined): ExecutionContext {
  const req = { header: (name: string) => (name === 'idempotency-key' ? key : undefined) };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

describe('IdempotencyInterceptor', () => {
  it('passes through untouched when no Idempotency-Key header is sent', async () => {
    const prisma = {
      idempotencyKey: { findUnique: jest.fn(), create: jest.fn() },
    } as unknown as PrismaService;
    const interceptor = new IdempotencyInterceptor(prisma);
    const handler: CallHandler = { handle: () => of({ ok: true }) };

    const result$ = await interceptor.intercept(contextWithHeader(undefined), handler);
    const value = await new Promise((resolve) => result$.subscribe(resolve));

    expect(value).toEqual({ ok: true });
    expect(prisma.idempotencyKey.findUnique).not.toHaveBeenCalled();
  });

  it('replays a stored response for a key already seen', async () => {
    const stored = { responseJson: JSON.stringify({ id: 'voucher-1' }) };
    const prisma = {
      idempotencyKey: {
        findUnique: jest.fn().mockResolvedValue(stored),
        create: jest.fn(),
      },
    } as unknown as PrismaService;
    const interceptor = new IdempotencyInterceptor(prisma);
    const handler: CallHandler = { handle: jest.fn(() => of({ id: 'a-different-voucher' })) };

    const result$ = await interceptor.intercept(contextWithHeader('key-123'), handler);
    const value = await new Promise((resolve) => result$.subscribe(resolve));

    expect(value).toEqual({ id: 'voucher-1' });
    expect(handler.handle).not.toHaveBeenCalled();
  });

  it('executes and stores the response for a new key', async () => {
    const created: unknown[] = [];
    const prisma = {
      idempotencyKey: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }: { data: unknown }) => {
          created.push(data);
          return Promise.resolve(data);
        }),
      },
    } as unknown as PrismaService;
    const interceptor = new IdempotencyInterceptor(prisma);
    const handler: CallHandler = { handle: () => of({ id: 'voucher-2' }) };

    const result$ = await interceptor.intercept(contextWithHeader('key-456'), handler);
    const value = await new Promise((resolve) => result$.subscribe(resolve));
    // The store write happens in a `tap` fired alongside emission — flush
    // the microtask queue so it's landed before we assert on it.
    await new Promise((resolve) => setImmediate(resolve));

    expect(value).toEqual({ id: 'voucher-2' });
    expect(created).toEqual([{ key: 'key-456', responseJson: JSON.stringify({ id: 'voucher-2' }) }]);
  });
});
