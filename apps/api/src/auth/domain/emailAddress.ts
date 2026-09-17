import { AuthException, AuthExceptionCode } from '@newtine/core';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Canonical email value used by authentication commands and persistence lookups. */
export class EmailAddress {
  private constructor(readonly value: string) {}

  static create(input: string): EmailAddress {
    const canonical = input.trim().toLowerCase();
    if (canonical.length === 0 || canonical.length > 254 || !EMAIL_PATTERN.test(canonical)) {
      throw new AuthException(AuthExceptionCode.InvalidEmail, '이메일 형식이 올바르지 않습니다.');
    }
    return new EmailAddress(canonical);
  }

  toString(): string {
    return this.value;
  }
}

export function canonicalizeEmail(email: string): string {
  return EmailAddress.create(email).value;
}
