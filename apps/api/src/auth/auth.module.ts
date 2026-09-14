import { Module } from '@nestjs/common';

import { CoreModule } from '@newtine/core';

import { AuthController } from './auth.controller.js';
import { AUTH_OPTIONS, createAuthOptions } from './auth.options.js';
import { AuthService } from './auth.service.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { JwtTokenService } from './jwt-token.service.js';
import { PasswordService } from './password.service.js';
import { RolesGuard } from './roles.guard.js';

@Module({
  imports: [CoreModule],
  controllers: [AuthController],
  providers: [
    {
      provide: AUTH_OPTIONS,
      useFactory: () => createAuthOptions(),
    },
    AuthService,
    JwtTokenService,
    JwtAuthGuard,
    PasswordService,
    RolesGuard,
  ],
  exports: [AUTH_OPTIONS, AuthService, JwtAuthGuard, JwtTokenService, RolesGuard],
})
export class AuthModule {}
