import { Injectable } from '@nestjs/common';
import { argon2id, hash, verify } from 'argon2';

import { AuthException, AuthExceptionCode } from '@newtine/core';

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

const ARGON2ID_OPTIONS = {
  type: argon2id,
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 4,
} as const;

@Injectable()
export class PasswordService {
  async hash(password: string): Promise<string> {
    assertPasswordLength(password);
    return hash(password, ARGON2ID_OPTIONS);
  }

  async verify(password: string, passwordHash: string): Promise<boolean> {
    assertPasswordLength(password);
    try {
      return await verify(passwordHash, password);
    } catch {
      return false;
    }
  }
}

export function assertPasswordLength(password: string): void {
  const length = Array.from(password).length;
  if (length < PASSWORD_MIN_LENGTH || length > PASSWORD_MAX_LENGTH) {
    throw new AuthException(
      AuthExceptionCode.InvalidPassword,
      `비밀번호는 ${PASSWORD_MIN_LENGTH}~${PASSWORD_MAX_LENGTH}자여야 합니다.`,
    );
  }
}
