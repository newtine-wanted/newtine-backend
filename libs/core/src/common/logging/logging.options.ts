import type { Request, Response } from 'express';
import type { Params } from 'nestjs-pino';

import { generateUuidV7 } from '@newtine/core/common/id/uuidV7.generator.js';
import { LoggingConfigurationException } from './logging.exception.js';

export const DEFAULT_HTTP_SLOW_THRESHOLD_MS = 1_000;

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];
export type LogService = 'api' | 'batch';

const REDACT_PATHS = [
  'password',
  'token',
  'accessToken',
  'refreshToken',
  'authorization',
  'cookie',
  'req.headers.authorization',
  'req.headers.cookie',
  'request.headers.authorization',
  'request.headers.cookie',
] as const;

export function createLoggerOptions(service: LogService): Params<Request, Response> {
  const environment = process.env.NODE_ENV ?? 'production';
  const level = resolveLogLevel(process.env.LOG_LEVEL, environment);

  return {
    pinoHttp: {
      level,
      base: { service },
      autoLogging: false,
      quietReqLogger: true,
      customAttributeKeys: { reqId: 'requestId' },
      genReqId: () => generateUuidV7(),
      redact: [...REDACT_PATHS],
      ...(environment === 'development'
        ? {
            transport: {
              target: 'pino-pretty',
              options: {
                colorize: false,
                singleLine: true,
                translateTime: 'SYS:standard',
              },
            },
          }
        : {}),
    },
  };
}

export function resolveLogLevel(value: string | undefined, environment: string): LogLevel {
  const level = value ?? (environment === 'development' ? 'debug' : 'info');
  if ((LOG_LEVELS as readonly string[]).includes(level)) {
    return level as LogLevel;
  }

  throw new LoggingConfigurationException('LOG_LEVEL', `must be one of ${LOG_LEVELS.join(', ')}`);
}

export function resolveHttpSlowThreshold(value = process.env.HTTP_SLOW_THRESHOLD_MS): number {
  if (value === undefined || value.trim() === '') {
    return DEFAULT_HTTP_SLOW_THRESHOLD_MS;
  }

  const threshold = Number(value);
  if (!Number.isSafeInteger(threshold) || threshold < 1) {
    throw new LoggingConfigurationException(
      'HTTP_SLOW_THRESHOLD_MS',
      'must be a positive integer in milliseconds',
    );
  }

  return threshold;
}

export const loggingRedactPaths = REDACT_PATHS;
