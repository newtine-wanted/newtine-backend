import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

// Registered immediately after the body parsers, before controller middleware.
export function bodyParserExceptionMiddleware(
  exception: unknown,
  _request: Request,
  _response: Response,
  next: NextFunction,
): void {
  if (exception instanceof Error && 'type' in exception && 'status' in exception) {
    if (exception.type === 'entity.parse.failed' && exception.status === 400) {
      next(new BadRequestException('요청 JSON 형식이 올바르지 않습니다.'));
      return;
    }
    if (exception.type === 'entity.too.large' && exception.status === 413) {
      next(new PayloadTooLargeException('요청 본문의 크기가 허용 한도를 초과했습니다.'));
      return;
    }
  }

  next(exception);
}
