import type { NextFunction, Request, Response } from 'express';
import { Injectable, type NestMiddleware } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import { generateUuidV7, resolveHttpSlowThreshold } from '@newtine/core';

export type HttpRequestContext = Request & {
  requestId: string;
  httpRequestStartedAt?: bigint;
  httpExceptionLogged?: boolean;
};

type PinoRequest = Request & { id?: string | number };
type HttpResponse = Response & { writableFinished?: boolean };
type Clock = () => bigint;

type LogFields = {
  event: 'http.slow' | 'http.aborted';
  requestId: string;
  method: string;
  path: string;
  durationMs: number;
  status?: number;
};

@Injectable()
export class HttpRequestContextMiddleware implements NestMiddleware {
  constructor(
    private readonly logger?: PinoLogger,
    private readonly slowThresholdMs = resolveHttpSlowThreshold(),
    private readonly now: Clock = () => process.hrtime.bigint(),
  ) {
    this.logger?.setContext(HttpRequestContextMiddleware.name);
  }

  use(request: HttpRequestContext, response: HttpResponse, next: NextFunction): void {
    const requestWithPinoId = request as PinoRequest & Partial<HttpRequestContext>;
    const requestId =
      typeof requestWithPinoId.id === 'string' ? requestWithPinoId.id : generateUuidV7();
    request.requestId = requestId;
    request.httpRequestStartedAt = this.now();
    response.setHeader('x-request-id', requestId);

    let terminal: 'finished' | 'aborted' | undefined;
    const finish = () => {
      if (terminal !== undefined) return;
      terminal = 'finished';

      const durationMs = elapsedMilliseconds(request.httpRequestStartedAt, this.now());
      if (
        durationMs < this.slowThresholdMs ||
        response.statusCode < 200 ||
        response.statusCode >= 400
      ) {
        return;
      }

      this.log({
        event: 'http.slow',
        requestId,
        method: request.method,
        path: request.path,
        status: response.statusCode,
        durationMs,
      });
    };
    const close = () => {
      if (terminal !== undefined) return;
      terminal = 'aborted';

      if (request.httpExceptionLogged || response.writableFinished) {
        return;
      }

      this.log({
        event: 'http.aborted',
        requestId,
        method: request.method,
        path: request.path,
        durationMs: elapsedMilliseconds(request.httpRequestStartedAt, this.now()),
      });
    };

    response.once('finish', finish);
    response.once('close', close);
    next();
  }

  private log(fields: LogFields): void {
    if (this.logger === undefined) return;

    const bindings = this.logger.logger.bindings();
    const payload = bindings.requestId === fields.requestId ? omitRequestId(fields) : fields;
    if (fields.event === 'http.slow') {
      this.logger.warn(payload, 'Slow HTTP request');
    } else {
      this.logger.warn(payload, 'HTTP request aborted');
    }
  }
}

function elapsedMilliseconds(startedAt: bigint | undefined, now: bigint): number {
  if (startedAt === undefined) return 0;
  return Number(now - startedAt) / 1_000_000;
}

function omitRequestId(fields: LogFields): Omit<LogFields, 'requestId'> {
  const fieldsWithoutRequestId = { ...fields };
  Reflect.deleteProperty(fieldsWithoutRequestId, 'requestId');
  return fieldsWithoutRequestId;
}
