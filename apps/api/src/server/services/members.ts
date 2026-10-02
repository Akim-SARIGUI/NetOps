import { Prisma, type RoleName as PrismaRoleName } from "../../../generated/prisma/client";
import { recordAudit } from "../audit";
import type { AuthUser } from "../auth/context";
import { ConflictError, ForbiddenError, NotFoundError } from "../errors";
import { prisma } from "../prisma";
import { assertPermission } from "../rbac/guard";
import type { RoleName } from "../rbac/permissions";

export async function listMembers(user: AuthUser, organizationId: string) {
  const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true } });
  if (!organization) throw new NotFoundError("Organisation introuvable");
  assertPermission(user, organizationId, "members:read", "Organisation introuvable");

  const memberships = await prisma.membership.findMany({
    where: { organizationId },
    include: { user: { select: { id: true, email: true, name: true, isActive: true } } },
    orderBy: { user: { email: "asc" } },
  });

  return {
    data: memberships.map((membership) => ({
      user: membership.user,
      role: membership.role,
      createdAt: membership.createdAt,
      updatedAt: membership.updatedAt,
    })),
  };
}

export async function addMember(user: AuthUser, organizationId: string, input: { email: string; role: RoleName }) {
  const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true } });
  if (!organization) throw new NotFoundError("Organisation introuvable");
  assertPermission(user, organizationId, "members:write", "Organisation introuvable");

  const target = await prisma.user.findUnique({ where: { email: input.email.toLowerCase() } });
  if (!target || !target.isActive) throw new NotFoundError("Utilisateur introuvable");

  try {
    const membership = await prisma.membership.create({
      data: {
        organizationId,
        userId: target.id,
        role: input.role as PrismaRoleName,
      },
    });
    await recordAudit({
      actor: user,
      organizationId,
      action: "member.add",
      resourceType: "Membership",
      resourceId: membership.id,
      metadata: { email: target.email, role: input.role },
    });
    return {
      user: { id: target.id, email: target.email, name: target.name, isActive: target.isActive },
      role: membership.role,
      createdAt: membership.createdAt,
      updatedAt: membership.updatedAt,
    };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new ConflictError("Cet utilisateur est déjà membre de l'organisation");
    }
    throw error;
  }
}

export async function updateMember(
  user: AuthUser,
  organizationId: string,
  userId: string,
  input: { role: RoleName },
) {
  assertPermission(user, organizationId, "members:write", "Organisation introuvable");
  if (user.id === userId) {
    throw new ForbiddenError("Vous ne pouvez pas modifier votre propre rôle");
  }

  const current = await prisma.membership.findUnique({
    where: { userId_organizationId: { userId, organizationId } },
    include: { user: { select: { email: true } } },
  });
  if (!current) throw new NotFoundError("Membre introuvable");

  const membership = await prisma.membership.update({
    where: { userId_organizationId: { userId, organizationId } },
    data: { role: input.role as PrismaRoleName },
  });
  await recordAudit({
    actor: user,
    organizationId,
    action: "member.update",
    resourceType: "Membership",
    resourceId: membership.id,
    metadata: { email: current.user.email, before: current.role, after: membership.role },
  });
  return { userId, organizationId, role: membership.role, updatedAt: membership.updatedAt };
}

export async function removeMember(user: AuthUser, organizationId: string, userId: string) {
  assertPermission(user, organizationId, "members:write", "Organisation introuvable");
  if (user.id === userId) {
    throw new ForbiddenError("Vous ne pouvez pas retirer votre propre accès");
  }

  const current = await prisma.membership.findUnique({
    where: { userId_organizationId: { userId, organizationId } },
    include: { user: { select: { email: true } } },
  });
  if (!current) throw new NotFoundError("Membre introuvable");

  await recordAudit({
    actor: user,
    organizationId,
    action: "member.remove",
    resourceType: "Membership",
    resourceId: current.id,
    metadata: { email: current.user.email, role: current.role },
  });
  await prisma.membership.delete({ where: { id: current.id } });
  return { ok: true };
}

export async function listAuditEvents(user: AuthUser, organizationId: string, query: { limit?: number; action?: string } = {}) {
  const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true } });
  if (!organization) throw new NotFoundError("Organisation introuvable");
  assertPermission(user, organizationId, "audit:read", "Organisation introuvable");

  const events = await prisma.auditEvent.findMany({
    where: { organizationId, ...(query.action ? { action: query.action } : {}) },
    include: { actor: { select: { id: true, email: true, name: true } } },
    orderBy: { createdAt: "desc" },
    take: query.limit ?? 50,
  });

  return { data: events };
}
