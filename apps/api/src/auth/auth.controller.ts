import { TypedBody, TypedException, TypedRoute } from '@nestia/core';
import { Controller, HttpCode, HttpStatus, Inject, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import typia from 'typia';

import type { AuthPrincipal } from '@newtine/core';
import { ApiException } from '@newtine/api/common/exception/api.exception.js';
import type { ProblemDetails } from '@newtine/api/common/filter/type/problemDetails.js';

import { assertAllowedOrigin } from './auth.origin.js';
import { clearRefreshCookie, readRefreshToken, setRefreshCookie } from './auth.cookie.js';
import { CurrentUser } from './auth.decorator.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { AUTH_OPTIONS, type AuthOptions } from './auth.options.js';
import type { AuthSessionResult } from './application/auth.types.js';
import { LoginUseCase } from './application/login.usecase.js';
import { LogoutUseCase } from './application/logout.usecase.js';
import { RefreshUseCase } from './application/refresh.usecase.js';
import { SignupUseCase } from './application/signup.usecase.js';
import { WithdrawUseCase } from './application/withdraw.usecase.js';
import type { AuthCredentialsRequest } from './auth.type.js';
import type { AuthSessionResponse } from './auth.type.js';
import { assertEmptyWithdrawalRequest } from './withdraw.request.js';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly signupUseCase: SignupUseCase,
    private readonly loginUseCase: LoginUseCase,
    private readonly refreshUseCase: RefreshUseCase,
    private readonly logoutUseCase: LogoutUseCase,
    private readonly withdrawUseCase: WithdrawUseCase,
    @Inject(AUTH_OPTIONS) private readonly options: AuthOptions,
  ) {}

  @TypedException<ProblemDetails>(ApiException.InvalidArgument)
  @TypedException<ProblemDetails>(ApiException.Conflict)
  @TypedException<ProblemDetails>(ApiException.InternalError)
  @HttpCode(HttpStatus.CREATED)
  @TypedRoute.Post('signup')
  async signup(
    @TypedBody<AuthCredentialsRequest>({
      type: 'validate',
      validate: (input) => typia.validateEquals<AuthCredentialsRequest>(input),
    })
    body: AuthCredentialsRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthSessionResponse> {
    const session = await this.signupUseCase.execute(body);
    return this.writeSession(response, session);
  }

  @TypedException<ProblemDetails>(ApiException.InvalidArgument)
  @TypedException<ProblemDetails>(ApiException.Unauthorized)
  @TypedException<ProblemDetails>(ApiException.InternalError)
  @HttpCode(HttpStatus.OK)
  @TypedRoute.Post('login')
  async login(
    @TypedBody<AuthCredentialsRequest>({
      type: 'validate',
      validate: (input) => typia.validateEquals<AuthCredentialsRequest>(input),
    })
    body: AuthCredentialsRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthSessionResponse> {
    const session = await this.loginUseCase.execute(body);
    return this.writeSession(response, session);
  }

  @TypedException<ProblemDetails>(ApiException.Unauthorized)
  @TypedException<ProblemDetails>(ApiException.Forbidden)
  @TypedException<ProblemDetails>(ApiException.InternalError)
  @HttpCode(HttpStatus.OK)
  @TypedRoute.Post('refresh')
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthSessionResponse> {
    assertAllowedOrigin(request, this.options);
    const session = await this.refreshUseCase.execute(readRefreshToken(request, this.options));
    return this.writeSession(response, session);
  }

  @TypedException<ProblemDetails>(ApiException.Forbidden)
  @TypedException<ProblemDetails>(ApiException.InternalError)
  @HttpCode(HttpStatus.NO_CONTENT)
  @TypedRoute.Post('logout')
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    assertAllowedOrigin(request, this.options);
    await this.logoutUseCase.execute(readRefreshToken(request, this.options));
    clearRefreshCookie(response, this.options);
  }

  /** @security bearerAuth */
  @TypedException<ProblemDetails>(ApiException.InvalidArgument)
  @TypedException<ProblemDetails>(ApiException.Unauthorized)
  @TypedException<ProblemDetails>(ApiException.Forbidden)
  @TypedException<ProblemDetails>(ApiException.RateLimited)
  @TypedException<ProblemDetails>(ApiException.ServiceUnavailable)
  @TypedException<ProblemDetails>(ApiException.InternalError)
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @TypedRoute.Post('withdraw')
  async withdraw(
    @Req() request: Request,
    @CurrentUser() principal: AuthPrincipal,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    assertAllowedOrigin(request, this.options);
    await assertEmptyWithdrawalRequest(request);
    await this.withdrawUseCase.execute(principal.userId);
    response.setHeader('Cache-Control', 'no-store');
    clearRefreshCookie(response, this.options);
  }

  private writeSession(response: Response, session: AuthSessionResult): AuthSessionResponse {
    response.setHeader('Cache-Control', 'no-store');
    setRefreshCookie(response, session.refreshToken, this.options);
    return {
      accessToken: session.accessToken,
      tokenType: 'Bearer',
      expiresIn: session.expiresIn,
      user: session.user,
    };
  }
}
