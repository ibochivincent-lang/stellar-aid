import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';

/**
 * Minimal admin gate for privileged endpoints (issuing/burning vouchers).
 *
 * This checks a shared secret (`ADMIN_API_KEY`) sent as `x-admin-key`. It is
 * intentionally simple — enough to stop these endpoints being wide open —
 * not a replacement for the SEP-45 passkey / JWT admin auth described in the
 * README architecture and tracked as its own Wave issue. Swap this guard out
 * once that lands; until then, an admin endpoint with no guard at all is
 * strictly worse than this.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  private readonly logger = new Logger(AdminGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const configuredKey = process.env.ADMIN_API_KEY;
    if (!configuredKey) {
      // Fail closed: an unconfigured secret must never mean "open to everyone".
      this.logger.error(
        'ADMIN_API_KEY is not configured — refusing all admin requests',
      );
      throw new UnauthorizedException('admin API is not configured');
    }

    const req = context.switchToHttp().getRequest<Request>();
    const provided = req.header('x-admin-key');
    if (!provided || provided !== configuredKey) {
      throw new UnauthorizedException('missing or invalid admin key');
    }
    return true;
  }
}
