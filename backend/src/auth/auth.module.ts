import { Global, Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';

/**
 * Global so `JwtAuthGuard`/`RolesGuard` can be used via `@UseGuards(...)`
 * from any controller without that controller's own module re-declaring
 * them as providers — mirrors `StellarModule`/`AuditModule`. Still needs
 * to be imported once (see the comment in `app.module.ts`) for Nest to
 * actually register it.
 */
@Global()
@Module({
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard, RolesGuard],
  exports: [AuthService, JwtAuthGuard, RolesGuard],
})
export class AuthModule {}
