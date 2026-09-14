import { DomainException } from '../common/exception/domain.exception.js';

export const AuthExceptionCode = {
  DuplicateEmail: 'AUTH_DUPLICATE_EMAIL',
  InvalidEmail: 'AUTH_INVALID_EMAIL',
  InvalidPassword: 'AUTH_INVALID_PASSWORD',
  InvalidCredentials: 'AUTH_INVALID_CREDENTIALS',
  InvalidRefreshToken: 'AUTH_INVALID_REFRESH_TOKEN',
} as const;

export type AuthExceptionCodeValue = (typeof AuthExceptionCode)[keyof typeof AuthExceptionCode];

export class AuthException extends DomainException<AuthExceptionCodeValue> {
  readonly domain = 'auth';

  constructor(code: AuthExceptionCodeValue, message: string, options?: ErrorOptions) {
    super(code, message, options);
  }
}
