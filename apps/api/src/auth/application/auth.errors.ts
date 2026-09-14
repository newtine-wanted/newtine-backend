import {
  AuthException,
  AuthExceptionCode,
  toAuthAccount,
  toAuthSessionUser,
  type AuthAccount,
  type AuthSessionUser,
  type AuthUser,
} from '@newtine/core';

export function invalidCredentials(): AuthException {
  return new AuthException(
    AuthExceptionCode.InvalidCredentials,
    '이메일 또는 비밀번호가 올바르지 않습니다.',
  );
}

export function invalidRefreshToken(): AuthException {
  return new AuthException(
    AuthExceptionCode.InvalidRefreshToken,
    'refresh token이 유효하지 않습니다.',
  );
}

export function requireAuthAccount(user: AuthUser): AuthAccount {
  const account = toAuthAccount(user);
  if (account === undefined) {
    throw invalidCredentials();
  }
  return account;
}

export function requireAuthSessionUser(user: AuthUser): AuthSessionUser {
  const sessionUser = toAuthSessionUser(user);
  if (sessionUser === undefined) {
    throw invalidCredentials();
  }
  return sessionUser;
}

export function duplicateEmail(error: unknown): AuthException | undefined {
  if (!isEmailUniqueViolation(error)) {
    return undefined;
  }
  return new AuthException(AuthExceptionCode.DuplicateEmail, '이미 사용 중인 이메일입니다.', {
    cause: error,
  });
}

function isEmailUniqueViolation(error: unknown): boolean {
  if (error === null || typeof error !== 'object') {
    return false;
  }
  const candidate = error as { readonly code?: unknown; readonly constraint?: unknown };
  return (
    candidate.code === '23505' &&
    typeof candidate.constraint === 'string' &&
    candidate.constraint.includes('users_email')
  );
}
