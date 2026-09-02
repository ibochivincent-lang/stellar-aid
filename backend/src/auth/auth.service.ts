import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';
import { AccessTokenPayload, AuthenticatedUser } from './jwt.types';

/**
 * Interim admin auth: a single operator account configured via env vars
 * (`ADMIN_USERNAME` / `ADMIN_PASSWORD_HASH`), issuing short-lived signed
 * JWTs instead of the previous `AdminGuard`'s static, never-expiring
 * shared secret sent on every request. This is still not the SEP-45
 * passkey / real user-auth system described in the README architecture
 * (ROADMAP.md Phase 2/3) — it's the step between "one static header value
 * grants full admin forever" and that, replacing the former with tokens
 * that expire, carry a role claim `RolesGuard` can check, and are never
 * sent as a long-lived credential on every single request.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  private get jwtSecret(): string {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      // Fail closed, same reasoning as the old AdminGuard: an unconfigured
      // secret must never silently mean "accept anything."
      this.logger.error('JWT_SECRET is not configured — refusing all auth requests');
      throw new UnauthorizedException('auth is not configured');
    }
    return secret;
  }

  private get tokenTtl(): string {
    return process.env.JWT_EXPIRES_IN ?? '15m';
  }

  async login(username: string, password: string): Promise<{ accessToken: string; expiresIn: string }> {
    const expectedUsername = process.env.ADMIN_USERNAME;
    const expectedHash = process.env.ADMIN_PASSWORD_HASH;
    if (!expectedUsername || !expectedHash) {
      this.logger.error('ADMIN_USERNAME/ADMIN_PASSWORD_HASH are not configured — refusing login');
      throw new UnauthorizedException('login is not configured');
    }

    // Constant-time-ish: always run bcrypt.compare even on a username
    // mismatch, so a wrong username doesn't return faster than a wrong
    // password and leak which one was wrong via timing.
    const usernameMatches = username === expectedUsername;
    const passwordMatches = await bcrypt.compare(password, expectedHash);
    if (!usernameMatches || !passwordMatches) {
      throw new UnauthorizedException('invalid credentials');
    }

    const payload: AccessTokenPayload = { sub: username, role: 'ADMIN' };
    const accessToken = jwt.sign(payload, this.jwtSecret, { expiresIn: this.tokenTtl } as jwt.SignOptions);
    return { accessToken, expiresIn: this.tokenTtl };
  }

  verify(token: string): AuthenticatedUser {
    try {
      return jwt.verify(token, this.jwtSecret) as AuthenticatedUser;
    } catch {
      throw new UnauthorizedException('invalid or expired token');
    }
  }
}
