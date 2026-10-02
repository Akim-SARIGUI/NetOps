import type { RoleName } from "../rbac/permissions";
import { UnauthorizedError } from "../errors";
import { prisma } from "../prisma";
import { permissionsForRole, type Permission } from "../rbac/permissions";
import { readAccessToken } from "./tokens";

export type PublicUser = {
  id: string;
  email: string;
  name: string;
  isSuperAdmin: boolean;
};

export type MembershipView = {
  organization: {
    id: string;
    name: string;
    slug: string;
  };
  role: RoleName;
  permissions: Permission[];
};

export type AuthUser = PublicUser & {
  memberships: Array<{
    organizationId: string;
    role: RoleName;
    organization: MembershipView["organization"];
  }>;
};

export type SessionPayload = {
  user: PublicUser;
  platformPermissions: Permission[];
  memberships: MembershipView[];
};

export async function requireUser(request: Request): Promise<AuthUser> {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) {
    throw new UnauthorizedError();
  }

  const userId = await readAccessToken(header.slice("Bearer ".length).trim());
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      memberships: {
        include: {
          organization: { select: { id: true, name: true, slug: true } },
        },
      },
    },
  });

  if (!user || !user.isActive) {
    throw new UnauthorizedError("Session invalide ou expirée");
  }

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    isSuperAdmin: user.isSuperAdmin,
    memberships: user.memberships.map((membership) => ({
      organizationId: membership.organizationId,
      role: membership.role,
      organization: membership.organization,
    })),
  };
}

export function toSession(user: AuthUser): SessionPayload {
  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      isSuperAdmin: user.isSuperAdmin,
    },
    platformPermissions: user.isSuperAdmin ? [...permissionsForRole("SUPER_ADMIN")] : [],
    memberships: user.memberships.map((membership) => ({
      organization: membership.organization,
      role: membership.role,
      permissions: [...permissionsForRole(membership.role)],
    })),
  };
}
