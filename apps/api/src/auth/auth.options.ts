export const AUTH_OPTIONS = Symbol('AUTH_OPTIONS');

export const AUTH_COOKIE_NAME = 'newtine_refresh';
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

const DEVELOPMENT_JWT_SECRET = 'newtine-development-jwt-secret-change-me-32-bytes';

export interface AuthOptions {
  readonly jwtSecret: Uint8Array;
  readonly jwtIssuer: string;
  readonly jwtAudience: string;
  readonly accessTokenTtlSeconds: number;
  readonly refreshTokenTtlSeconds: number;
  readonly cookieName: string;
  readonly cookieSecure: boolean;
  readonly allowedOrigins: readonly string[];
}

export class AuthenticationConfigurationException extends Error {
  constructor(message: string) {
    super(`Authentication configuration: ${message}`);
    this.name = AuthenticationConfigurationException.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function createAuthOptions(env: NodeJS.ProcessEnv = process.env): AuthOptions {
  const allowDevelopmentDefaults = env.NODE_ENV === 'development' || env.NODE_ENV === 'test';
  const rawSecret =
    env.JWT_SECRET ?? (allowDevelopmentDefaults ? DEVELOPMENT_JWT_SECRET : undefined);
  if (rawSecret === undefined || rawSecret.trim() === '') {
    throw new AuthenticationConfigurationException(
      'JWT_SECRET must be set outside development/test',
    );
  }

  const jwtSecret = new TextEncoder().encode(rawSecret);
  if (jwtSecret.byteLength < 32) {
    throw new AuthenticationConfigurationException(
      'JWT_SECRET must contain at least 32 UTF-8 bytes',
    );
  }

  const cookieSecure = parseCookieSecure(env, env.NODE_ENV === 'production');
  const allowedOrigins = parseAllowedOrigins(env.AUTH_ALLOWED_ORIGINS);
  if (!allowDevelopmentDefaults && allowedOrigins.length === 0) {
    throw new AuthenticationConfigurationException(
      'AUTH_ALLOWED_ORIGINS must contain at least one origin outside development/test',
    );
  }

  return {
    jwtSecret,
    jwtIssuer: nonEmpty(env.JWT_ISSUER, 'newtine-api'),
    jwtAudience: nonEmpty(env.JWT_AUDIENCE, 'newtine-client'),
    accessTokenTtlSeconds: ACCESS_TOKEN_TTL_SECONDS,
    refreshTokenTtlSeconds: REFRESH_TOKEN_TTL_SECONDS,
    cookieName: AUTH_COOKIE_NAME,
    cookieSecure,
    allowedOrigins,
  };
}

function parseCookieSecure(env: NodeJS.ProcessEnv, production: boolean): boolean {
  const configured = env.AUTH_COOKIE_SECURE;
  if (configured === undefined || configured.trim() === '') {
    return production;
  }
  if (configured !== 'true' && configured !== 'false') {
    throw new AuthenticationConfigurationException('AUTH_COOKIE_SECURE must be true or false');
  }
  if (production && configured !== 'true') {
    throw new AuthenticationConfigurationException('AUTH_COOKIE_SECURE must be true in production');
  }
  return configured === 'true';
}

function parseAllowedOrigins(value: string | undefined): readonly string[] {
  if (value === undefined || value.trim() === '') {
    return [];
  }

  return value.split(',').map((rawOrigin) => {
    const origin = rawOrigin.trim();
    if (origin === '') {
      throw new AuthenticationConfigurationException(
        'AUTH_ALLOWED_ORIGINS cannot contain an empty item',
      );
    }
    try {
      const parsed = new URL(origin);
      if (
        (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
        parsed.origin !== origin
      ) {
        throw new Error('not an origin');
      }
      return parsed.origin;
    } catch {
      throw new AuthenticationConfigurationException(
        'AUTH_ALLOWED_ORIGINS must contain absolute http(s) origins',
      );
    }
  });
}

function nonEmpty(value: string | undefined, fallback: string): string {
  const resolved = value ?? fallback;
  if (resolved.trim() === '') {
    throw new AuthenticationConfigurationException('JWT_ISSUER and JWT_AUDIENCE must be non-empty');
  }
  return resolved;
}
