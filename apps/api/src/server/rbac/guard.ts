import type { AuthUser } from "../auth/context";
import { ForbiddenError, NotFoundError } from "../errors";
import { userCanAccessOrganization, userHasPermission, type Permission } from "./permissions";

export function assertSuperAdmin(user: AuthUser) {
  if (!user.isSuperAdmin) {
    throw new ForbiddenError("Action réservée au super administrateur");
  }
}

export function assertInOrganization(user: AuthUser, organizationId: string, hiddenAs: string) {
  if (!userCanAccessOrganization(user, organizationId)) {
    throw new NotFoundError(hiddenAs);
  }
}

export function assertPermission(
  user: AuthUser,
  organizationId: string,
  permission: Permission,
  hiddenAs: string,
) {
  assertInOrganization(user, organizationId, hiddenAs);
  if (!userHasPermission(user, organizationId, permission)) {
    throw new ForbiddenError();
  }
}
