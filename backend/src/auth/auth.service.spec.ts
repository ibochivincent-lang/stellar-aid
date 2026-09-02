import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  const env = { ...process.env };

  beforeEach(() => {
    process.env.JWT_SECRET = 'test-jwt-secret';
    process.env.JWT_EXPIRES_IN = '15m';
    process.env.ADMIN_USERNAME = 'admin';
    process.env.ADMIN_PASSWORD_HASH = bcrypt.hashSync('correct-horse', 10);
  });

  afterEach(() => {
    process.env = { ...env };
  });

  it('fails closed when JWT_SECRET is not configured', async () => {
    delete process.env.JWT_SECRET;
    const auth = new AuthService();
    await expect(auth.login('admin', 'correct-horse')).rejects.toThrow('auth is not configured');
  });

  it('fails closed when admin credentials are not configured', async () => {
    delete process.env.ADMIN_USERNAME;
    const auth = new AuthService();
    await expect(auth.login('admin', 'correct-horse')).rejects.toThrow('login is not configured');
  });

  it('rejects a wrong password', async () => {
    const auth = new AuthService();
    await expect(auth.login('admin', 'wrong-password')).rejects.toThrow('invalid credentials');
  });

  it('rejects a wrong username', async () => {
    const auth = new AuthService();
    await expect(auth.login('not-admin', 'correct-horse')).rejects.toThrow('invalid credentials');
  });

  it('issues a verifiable token on correct credentials', async () => {
    const auth = new AuthService();
    const { accessToken } = await auth.login('admin', 'correct-horse');
    expect(typeof accessToken).toBe('string');

    const decoded = auth.verify(accessToken);
    expect(decoded.sub).toBe('admin');
    expect(decoded.role).toBe('ADMIN');
  });

  it('rejects a token signed with a different secret', async () => {
    const auth = new AuthService();
    const { accessToken } = await auth.login('admin', 'correct-horse');

    process.env.JWT_SECRET = 'a-different-secret';
    const authWithNewSecret = new AuthService();
    expect(() => authWithNewSecret.verify(accessToken)).toThrow('invalid or expired token');
  });

  it('rejects garbage tokens', () => {
    const auth = new AuthService();
    expect(() => auth.verify('not-a-real-token')).toThrow('invalid or expired token');
  });
});
