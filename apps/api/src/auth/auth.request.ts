import type { Request } from 'express';

import type { AuthPrincipal } from '@newtine/core';

/** Request fields populated only by the authentication guard. */
export interface AuthenticatedRequest extends Request {
  principal?: AuthPrincipal;
}
