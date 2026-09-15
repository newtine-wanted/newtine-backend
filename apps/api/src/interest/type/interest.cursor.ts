import { BadRequestException } from '@nestjs/common';

import { isCategoryCode, type CategoryCode, type InterestCursor } from '@newtine/core';
import { isUuidV7, type UuidV7 } from '@newtine/core/common/id/uuidV7.generator.js';

type CursorPayload = {
  readonly v: 1;
  readonly likedAt: string;
  readonly issueId: string;
  readonly categoryCode?: string;
};

export function encodeInterestCursor(cursor: InterestCursor): string {
  const payload: CursorPayload = {
    v: 1,
    likedAt: cursor.likedAt.toISOString(),
    issueId: cursor.issueId,
    ...(cursor.categoryCode === undefined ? {} : { categoryCode: cursor.categoryCode }),
  };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeInterestCursor(
  value: string,
  categoryCode: CategoryCode | undefined,
): InterestCursor {
  let payload: unknown;
  try {
    const decoded = Buffer.from(value, 'base64url');
    if (decoded.length === 0 || decoded.toString('base64url') !== value) {
      throw new Error('non-canonical cursor');
    }
    payload = JSON.parse(decoded.toString('utf8')) as unknown;
  } catch {
    throw new BadRequestException('커서가 올바르지 않습니다.');
  }

  if (!isCursorPayload(payload)) {
    throw new BadRequestException('커서가 올바르지 않습니다.');
  }
  if (payload.categoryCode !== categoryCode) {
    throw new BadRequestException('커서의 분류 필터가 현재 요청과 다릅니다.');
  }

  const likedAt = new Date(payload.likedAt);
  if (!Number.isFinite(likedAt.getTime())) {
    throw new BadRequestException('커서의 정렬 시각이 올바르지 않습니다.');
  }
  return {
    likedAt,
    issueId: payload.issueId as UuidV7,
    ...(payload.categoryCode === undefined
      ? {}
      : { categoryCode: payload.categoryCode as CategoryCode }),
  };
}

function isCursorPayload(value: unknown): value is CursorPayload {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    record.v === 1 &&
    typeof record.likedAt === 'string' &&
    typeof record.issueId === 'string' &&
    isUuidV7(record.issueId) &&
    (record.categoryCode === undefined ||
      (typeof record.categoryCode === 'string' && isCategoryCode(record.categoryCode)))
  );
}
