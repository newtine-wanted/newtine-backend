import { TypedException, TypedRoute } from '@nestia/core';
import { Controller } from '@nestjs/common';

import { ApiException } from '@newtine/api/common/exception/api.exception.js';
import type { ProblemDetails } from '@newtine/api/common/filter/type/problemDetails.js';

@Controller('health')
export class HealthController {
  @TypedException<ProblemDetails>(ApiException.InternalError)
  @TypedRoute.Get()
  getHealth(): { status: 'ok' } {
    return { status: 'ok' as const };
  }
}
