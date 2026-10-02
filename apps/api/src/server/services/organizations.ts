import { Prisma } from "../../../generated/prisma/client";
import { recordAudit } from "../audit";
import type { AuthUser } from "../auth/context";
import { ConflictError, NotFoundError } from "../errors";
import { prisma } from "../prisma";
import { assertPermission, assertSuperAdmin } from "../rbac/guard";

function slugify(value: string): string {
  const slug = value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "organisation";
}

function mapOrganization(organization: {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
  updatedAt: Date;
  _count?: { sites: number; memberships: number };
}) {
  return {
    id: organization.id,
    name: organization.name,
    slug: organization.slug,
    createdAt: organization.createdAt,
    updatedAt: organization.updatedAt,
    counts: organization._count
      ? { sites: organization._count.sites, members: organization._count.memberships }
      : undefined,
  };
}

export async function listOrganizations(user: AuthUser) {
  const organizations = await prisma.organization.findMany({
    where: user.isSuperAdmin
      ? undefined
      : { id: { in: user.memberships.map((membership) => membership.organizationId) } },
    include: { _count: { select: { sites: true, memberships: true } } },
    orderBy: { name: "asc" },
  });
  return { data: organizations.map(mapOrganization) };
}

export async function getOrganization(user: AuthUser, organizationId: string) {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    include: { _count: { select: { sites: true, memberships: true } } },
  });
  if (!organization) throw new NotFoundError("Organisation introuvable");
  assertPermission(user, organization.id, "hierarchy:read", "Organisation introuvable");
  return mapOrganization(organization);
}

export async function createOrganization(user: AuthUser, input: { name: string; slug?: string }) {
  assertSuperAdmin(user);
  const slug = input.slug ?? slugify(input.name);
  try {
    const organization = await prisma.organization.create({
      data: { name: input.name.trim(), slug },
      include: { _count: { select: { sites: true, memberships: true } } },
    });
    await recordAudit({
      actor: user,
      organizationId: organization.id,
      action: "organization.create",
      resourceType: "Organization",
      resourceId: organization.id,
      metadata: { name: organization.name, slug: organization.slug },
    });
    return mapOrganization(organization);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new ConflictError("Une organisation porte déjà ce slug");
    }
    throw error;
  }
}

export async function updateOrganization(
  user: AuthUser,
  organizationId: string,
  input: { name?: string; slug?: string },
) {
  const current = await prisma.organization.findUnique({ where: { id: organizationId } });
  if (!current) throw new NotFoundError("Organisation introuvable");
  assertPermission(user, current.id, "org:update", "Organisation introuvable");
  if (input.slug && input.slug !== current.slug) assertSuperAdmin(user);

  try {
    const organization = await prisma.organization.update({
      where: { id: organizationId },
      data: {
        name: input.name?.trim(),
        slug: input.slug,
      },
      include: { _count: { select: { sites: true, memberships: true } } },
    });
    await recordAudit({
      actor: user,
      organizationId: organization.id,
      action: "organization.update",
      resourceType: "Organization",
      resourceId: organization.id,
      metadata: {
        before: { name: current.name, slug: current.slug },
        after: { name: organization.name, slug: organization.slug },
      },
    });
    return mapOrganization(organization);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new ConflictError("Une organisation porte déjà ce slug");
    }
    throw error;
  }
}

export async function deleteOrganization(user: AuthUser, organizationId: string) {
  assertSuperAdmin(user);
  const current = await prisma.organization.findUnique({
    where: { id: organizationId },
    include: { _count: { select: { sites: true } } },
  });
  if (!current) throw new NotFoundError("Organisation introuvable");
  if (current._count.sites > 0) {
    throw new ConflictError("Cette organisation contient des sites. Retirez-les avant de la supprimer.");
  }

  await recordAudit({
    actor: user,
    organizationId: current.id,
    action: "organization.delete",
    resourceType: "Organization",
    resourceId: current.id,
    metadata: { name: current.name, slug: current.slug },
  });
  await prisma.organization.delete({ where: { id: organizationId } });
  return { ok: true };
}
