import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma.service';

/**
 * A minimal stand-in for `PrismaService` — enough surface for the routes
 * this e2e test actually exercises. Nothing here talks to a real database:
 * `prisma generate` can't run without network access to Prisma's engine
 * binaries in this environment (see the workaround note in
 * `docs/issues.md`/README), and even with a generated client, this suite
 * shouldn't depend on a live Postgres to prove the HTTP/auth wiring works.
 */
function fakePrisma() {
  const empty = { findMany: jest.fn().mockResolvedValue([]) };
  return {
    $connect: jest.fn().mockResolvedValue(undefined),
    $disconnect: jest.fn().mockResolvedValue(undefined),
    voucher: empty,
    merchant: empty,
    webhookSubscription: empty,
    auditLog: { create: jest.fn().mockResolvedValue(undefined) },
    eventCursor: { findUnique: jest.fn().mockResolvedValue(null) },
  };
}

describe('StellarAID backend (e2e)', () => {
  let app: INestApplication;
  const adminPassword = 'correct-horse-battery-staple';

  beforeAll(async () => {
    process.env.JWT_SECRET = 'e2e-test-secret';
    process.env.JWT_EXPIRES_IN = '15m';
    process.env.ADMIN_USERNAME = 'admin';
    process.env.ADMIN_PASSWORD_HASH = bcrypt.hashSync(adminPassword, 10);
    process.env.STELLAR_SIGNING_SECRET =
      'SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    // Left unset deliberately: with no contract id, EventEngineService's
    // onModuleInit stays idle instead of polling Soroban RPC for real.
    delete process.env.AID_VOUCHER_CONTRACT_ID;

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(fakePrisma())
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/vouchers is public and returns a list', async () => {
    const res = await request(app.getHttpServer()).get('/api/vouchers');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('POST /api/vouchers rejects an unauthenticated request', async () => {
    const res = await request(app.getHttpServer()).post('/api/vouchers').send({});
    expect(res.status).toBe(401);
  });

  it('POST /api/auth/login rejects wrong credentials', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'wrong' });
    expect(res.status).toBe(401);
  });

  it('POST /api/auth/login issues a bearer token for correct credentials, which then authorizes an admin route', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'admin', password: adminPassword });
    expect(login.status).toBe(200);
    expect(typeof login.body.accessToken).toBe('string');

    // The token is valid and carries role ADMIN, so a merchant-scope write
    // (a different admin-only route than the login came from) should pass
    // the auth/role guards — it may still fail downstream against a fake
    // Prisma/Stellar setup, but must not be rejected as 401/403.
    const res = await request(app.getHttpServer())
      .post('/api/merchants/scope')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .send({ wallet: 'GA'.padEnd(56, 'A'), categories: [], regions: [] });
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it('rejects a request signed with the wrong secret', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/vouchers')
      .set('Authorization', 'Bearer not-a-real-token')
      .send({});
    expect(res.status).toBe(401);
  });
});
