import { Module } from '@nestjs/common';

import { CoreModule } from '@newtine/core';

import { AuthController } from './auth.controller.js';
import { AUTH_OPTIONS, createAuthOptions } from './auth.options.js';
import { AccessPrincipalService } from './application/access-principal.service.js';
import { LoginUseCase } from './application/login.usecase.js';
import { LogoutUseCase } from './application/logout.usecase.js';
import { RefreshUseCase } from './application/refresh.usecase.js';
import { SessionIssuer } from './application/session-issuer.js';
import { SignupUseCase } from './application/signup.usecase.js';
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
    AccessPrincipalService,
    LoginUseCase,
    LogoutUseCase,
    RefreshUseCase,
    SessionIssuer,
    SignupUseCase,
    JwtTokenService,
    JwtAuthGuard,
    PasswordService,
    RolesGuard,
  ],
  exports: [AUTH_OPTIONS, AccessPrincipalService, JwtAuthGuard, JwtTokenService, RolesGuard],
})
export class AuthModule {}
