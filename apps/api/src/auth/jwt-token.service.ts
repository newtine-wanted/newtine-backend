import { Injectable, Inject } from '@nestjs/common';
import { jwtVerify, SignJWT } from 'jose';

import { isUuidV7 } from '@newtine/core';
import { generateUuidV7 } from '@newtine/core/common/id/uuidV7.generator.js';

import { AUTH_OPTIONS, type AuthOptions } from './auth.options.js';

@Injectable()
export class JwtTokenService {
  constructor(@Inject(AUTH_OPTIONS) private readonly options: AuthOptions) {}

  signAccessToken(userId: string): Promise<string> {
    const issuedAt = Math.floor(Date.now() / 1000);
    return new SignJWT({})
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuer(this.options.jwtIssuer)
      .setAudience(this.options.jwtAudience)
      .setSubject(userId)
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + this.options.accessTokenTtlSeconds)
      .setJti(generateUuidV7())
      .sign(this.options.jwtSecret);
  }

  async verifyAccessToken(token: string): Promise<string> {
    const { payload } = await jwtVerify(token, this.options.jwtSecret, {
      algorithms: ['HS256'],
      issuer: this.options.jwtIssuer,
      audience: this.options.jwtAudience,
    });
    if (typeof payload.sub !== 'string' || !isUuidV7(payload.sub)) {
      throw new Error('JWT subject is not a UUIDv7');
    }
    return payload.sub;
  }
}
