import type { Request } from 'express';

import type { AuthRoleValue } from '@newtine/core';

/** Request fields populated only by the authentication guard. */
export interface AuthenticatedRequest extends Request {
  authenticatedUserId?: string;
  authenticatedUserRole?: AuthRoleValue;
}
