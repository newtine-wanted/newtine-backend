import { SetMetadata } from '@nestjs/common';

import type { AuthRoleValue } from '@newtine/core';

export const AUTH_ROLES_KEY = 'auth:roles';

export const Roles = (...roles: AuthRoleValue[]) => SetMetadata(AUTH_ROLES_KEY, roles);
