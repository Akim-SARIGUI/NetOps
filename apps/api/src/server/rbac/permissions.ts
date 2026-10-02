export const ROLE_NAMES = [
  "SUPER_ADMIN",
  "NETWORK_ADMIN",
  "NETWORK_OPERATOR",
  "AUDITOR",
  "VIEWER",
] as const;

export type RoleName = (typeof ROLE_NAMES)[number];

export const PERMISSIONS = [
  "org:create",
  "org:update",
  "org:delete",
  "hierarchy:read",
  "hierarchy:write",
  "hierarchy:delete",
  "members:read",
  "members:write",
  "audit:read",
  "inventory:read",
  "inventory:write",
  "inventory:delete",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ALL_PERMISSIONS: readonly Permission[] = PERMISSIONS;

export const ROLE_PERMISSIONS: Record<RoleName, readonly Permission[]> = {
  SUPER_ADMIN: ALL_PERMISSIONS,
  NETWORK_ADMIN: [
    "org:update",
    "hierarchy:read",
    "hierarchy:write",
    "hierarchy:delete",
    "members:read",
    "members:write",
    "audit:read",
    "inventory:read",
    "inventory:write",
    "inventory:delete",
  ],
  NETWORK_OPERATOR: ["hierarchy:read", "hierarchy:write", "inventory:read", "inventory:write"],
  AUDITOR: ["hierarchy:read", "audit:read", "inventory:read"],
  VIEWER: ["hierarchy:read", "inventory:read"],
};

export type MembershipAccess = {
  organizationId: string;
  role: RoleName;
};

export function permissionsForRole(role: RoleName): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}

export function userHasPermission(
  user: { isSuperAdmin: boolean; memberships: MembershipAccess[] },
  organizationId: string,
  permission: Permission,
): boolean {
  if (user.isSuperAdmin) return true;
  const membership = user.memberships.find((item) => item.organizationId === organizationId);
  if (!membership) return false;
  return permissionsForRole(membership.role).includes(permission);
}

export function userCanAccessOrganization(
  user: { isSuperAdmin: boolean; memberships: MembershipAccess[] },
  organizationId: string,
): boolean {
  return user.isSuperAdmin || user.memberships.some((item) => item.organizationId === organizationId);
}
