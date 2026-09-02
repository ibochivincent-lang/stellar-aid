/** Shape of the payload every StellarAID access token carries. */
export interface AccessTokenPayload {
  /** Subject — the authenticated principal's username (or id, once real user auth lands). */
  sub: string;
  /** Prisma `Role` enum value: CITIZEN | MERCHANT | ADMIN | AUDITOR. */
  role: string;
}

/** What `JwtAuthGuard` attaches to `req.user` on a valid token. */
export type AuthenticatedUser = AccessTokenPayload & { iat: number; exp: number };
