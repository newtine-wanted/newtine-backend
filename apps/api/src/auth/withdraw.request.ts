import { BadRequestException } from '@nestjs/common';
import type { Request } from 'express';

export async function assertEmptyWithdrawalRequest(request: Request): Promise<void> {
  const body = request.body;
  if (body === undefined && hasUnparsedBody(request)) {
    throw new BadRequestException('회원탈퇴 요청 본문은 비워야 합니다.');
  }
  if (body === undefined && hasChunkedBody(request)) {
    for await (const chunk of request) {
      if (chunkByteLength(chunk) > 0) {
        throw new BadRequestException('회원탈퇴 요청 본문은 비워야 합니다.');
      }
    }
  }
  if (
    body !== undefined &&
    (body === null ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      Object.keys(body).length > 0)
  ) {
    throw new BadRequestException('회원탈퇴 요청 본문은 비워야 합니다.');
  }

  const query = request.query;
  if (query !== undefined && query !== null && Object.keys(query).length > 0) {
    throw new BadRequestException('회원탈퇴 요청에는 query parameter를 사용할 수 없습니다.');
  }
}

function hasUnparsedBody(request: Request): boolean {
  const contentLength = request.headers?.['content-length'];
  const lengths = Array.isArray(contentLength) ? contentLength : [contentLength];
  if (
    lengths.some((value) => {
      if (typeof value !== 'string' || value.trim() === '') return false;
      const parsed = Number(value);
      return Number.isFinite(parsed) && parsed > 0;
    })
  ) {
    return true;
  }

  return false;
}

function hasChunkedBody(request: Request): boolean {
  const transferEncoding = request.headers?.['transfer-encoding'];
  return Array.isArray(transferEncoding)
    ? transferEncoding.length > 0
    : typeof transferEncoding === 'string' && transferEncoding.trim() !== '';
}

function chunkByteLength(chunk: unknown): number {
  if (typeof chunk === 'string') return Buffer.byteLength(chunk);
  if (Buffer.isBuffer(chunk)) return chunk.byteLength;
  if (chunk instanceof Uint8Array) return chunk.byteLength;
  return Buffer.byteLength(String(chunk));
}
