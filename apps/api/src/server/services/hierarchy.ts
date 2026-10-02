import { Prisma, type Environment } from "../../../generated/prisma/client";
import { recordAudit } from "../audit";
import type { AuthUser } from "../auth/context";
import { ConflictError, NotFoundError } from "../errors";
import { prisma } from "../prisma";
import { assertPermission } from "../rbac/guard";
import type { Permission } from "../rbac/permissions";
import { emptyToNull, normalizeCode } from "../validation/common";

function rethrowUnique(error: unknown, message: string): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    throw new ConflictError(message);
  }
  throw error;
}

async function organizationOfSite(siteId: string) {
  const site = await prisma.site.findUnique({
    where: { id: siteId },
    select: { id: true, organizationId: true, name: true, code: true },
  });
  if (!site) throw new NotFoundError("Site introuvable");
  return site;
}

function guard(user: AuthUser, organizationId: string, permission: Permission, hiddenAs: string) {
  assertPermission(user, organizationId, permission, hiddenAs);
}

export async function listSites(user: AuthUser, organizationId: string) {
  const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true } });
  if (!organization) throw new NotFoundError("Organisation introuvable");
  guard(user, organizationId, "hierarchy:read", "Organisation introuvable");

  const sites = await prisma.site.findMany({
    where: { organizationId },
    include: { _count: { select: { buildings: true } } },
    orderBy: { name: "asc" },
  });

  return {
    data: sites.map((site) => ({
      id: site.id,
      organizationId: site.organizationId,
      name: site.name,
      code: site.code,
      environment: site.environment,
      address: site.address,
      createdAt: site.createdAt,
      updatedAt: site.updatedAt,
      counts: { buildings: site._count.buildings },
    })),
  };
}

export async function createSite(
  user: AuthUser,
  organizationId: string,
  input: { name: string; code: string; environment?: Environment; address?: string | null },
) {
  const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true } });
  if (!organization) throw new NotFoundError("Organisation introuvable");
  guard(user, organizationId, "hierarchy:write", "Organisation introuvable");

  try {
    const site = await prisma.site.create({
      data: {
        organizationId,
        name: input.name.trim(),
        code: normalizeCode(input.code),
        environment: input.environment ?? "PRODUCTION",
        address: emptyToNull(input.address) ?? null,
      },
    });
    await recordAudit({
      actor: user,
      organizationId,
      action: "site.create",
      resourceType: "Site",
      resourceId: site.id,
      metadata: { name: site.name, code: site.code, environment: site.environment },
    });
    return site;
  } catch (error) {
    rethrowUnique(error, "Ce code de site existe déjà dans l'organisation");
  }
}

export async function getSite(user: AuthUser, siteId: string) {
  const site = await prisma.site.findUnique({
    where: { id: siteId },
    include: {
      organization: { select: { id: true, name: true, slug: true } },
      _count: { select: { buildings: true } },
    },
  });
  if (!site) throw new NotFoundError("Site introuvable");
  guard(user, site.organizationId, "hierarchy:read", "Site introuvable");
  return {
    id: site.id,
    organizationId: site.organizationId,
    name: site.name,
    code: site.code,
    environment: site.environment,
    address: site.address,
    createdAt: site.createdAt,
    updatedAt: site.updatedAt,
    counts: { buildings: site._count.buildings },
    organization: site.organization,
  };
}

export async function updateSite(
  user: AuthUser,
  siteId: string,
  input: { name?: string; code?: string; environment?: Environment; address?: string | null },
) {
  const current = await organizationOfSite(siteId);
  guard(user, current.organizationId, "hierarchy:write", "Site introuvable");
  try {
    const site = await prisma.site.update({
      where: { id: siteId },
      data: {
        name: input.name?.trim(),
        code: input.code ? normalizeCode(input.code) : undefined,
        environment: input.environment,
        address: emptyToNull(input.address),
      },
    });
    await recordAudit({
      actor: user,
      organizationId: current.organizationId,
      action: "site.update",
      resourceType: "Site",
      resourceId: site.id,
      metadata: { before: { name: current.name, code: current.code }, after: { name: site.name, code: site.code } },
    });
    return site;
  } catch (error) {
    rethrowUnique(error, "Ce code de site existe déjà dans l'organisation");
  }
}

export async function deleteSite(user: AuthUser, siteId: string) {
  const current = await prisma.site.findUnique({
    where: { id: siteId },
    include: { _count: { select: { buildings: true, devices: true, vlans: true, ipNetworks: true, dhcpServers: true, dnsServers: true, topologyMarkers: true, discoveryRuns: true } } },
  });
  if (!current) throw new NotFoundError("Site introuvable");
  guard(user, current.organizationId, "hierarchy:delete", "Site introuvable");
  if (current._count.buildings > 0) {
    throw new ConflictError("Ce site contient des bâtiments. Retirez-les avant de supprimer le site.");
  }
  if (current._count.devices > 0) {
    throw new ConflictError("Ce site porte des équipements. Retirez-les avant de supprimer le site.");
  }
  if (current._count.vlans > 0) {
    throw new ConflictError("Ce site porte des VLAN. Retirez-les avant de supprimer le site.");
  }
  if (current._count.ipNetworks > 0) {
    throw new ConflictError("Ce site porte des réseaux. Retirez-les avant de supprimer le site.");
  }
  if (current._count.dhcpServers > 0) {
    throw new ConflictError("Ce site porte des serveurs DHCP. Retirez-les avant de supprimer le site.");
  }
  if (current._count.dnsServers > 0) {
    throw new ConflictError("Ce site porte des serveurs DNS. Retirez-les avant de supprimer le site.");
  }
  if (current._count.topologyMarkers > 0) {
    throw new ConflictError("Ce site porte un nœud de topologie. Retirez-le avant de supprimer le site.");
  }
  if (current._count.discoveryRuns > 0) {
    throw new ConflictError("Ce site est lié à une découverte. Retirez le dossier avant de supprimer le site.");
  }
  const labFabrics = await prisma.labFabric.count({ where: { siteId: current.id } });
  if (labFabrics > 0) {
    throw new ConflictError("Ce site porte une fabrique LAB. Retirez-la avant de supprimer le site.");
  }
  const labPromotions = await prisma.labPromotion.count({ where: { targetSiteId: current.id } });
  if (labPromotions > 0) {
    throw new ConflictError("Ce site est la cible d'une promotion LAB. Retirez-la avant de supprimer le site.");
  }
  await recordAudit({
    actor: user,
    organizationId: current.organizationId,
    action: "site.delete",
    resourceType: "Site",
    resourceId: current.id,
    metadata: { name: current.name, code: current.code },
  });
  await prisma.site.delete({ where: { id: siteId } });
  return { ok: true };
}

export async function listBuildings(user: AuthUser, siteId: string) {
  const site = await organizationOfSite(siteId);
  guard(user, site.organizationId, "hierarchy:read", "Site introuvable");
  const buildings = await prisma.building.findMany({
    where: { siteId },
    include: { _count: { select: { rooms: true } } },
    orderBy: { name: "asc" },
  });
  return {
    data: buildings.map((building) => ({
      id: building.id,
      siteId: building.siteId,
      name: building.name,
      code: building.code,
      createdAt: building.createdAt,
      updatedAt: building.updatedAt,
      counts: { rooms: building._count.rooms },
    })),
  };
}

export async function createBuilding(user: AuthUser, siteId: string, input: { name: string; code: string }) {
  const site = await organizationOfSite(siteId);
  guard(user, site.organizationId, "hierarchy:write", "Site introuvable");
  try {
    const building = await prisma.building.create({
      data: { siteId, name: input.name.trim(), code: normalizeCode(input.code) },
    });
    await recordAudit({
      actor: user,
      organizationId: site.organizationId,
      action: "building.create",
      resourceType: "Building",
      resourceId: building.id,
      metadata: { name: building.name, code: building.code, siteId },
    });
    return building;
  } catch (error) {
    rethrowUnique(error, "Ce code de bâtiment existe déjà sur ce site");
  }
}

export async function getBuilding(user: AuthUser, buildingId: string) {
  const building = await prisma.building.findUnique({
    where: { id: buildingId },
    include: {
      site: {
        select: {
          id: true,
          name: true,
          code: true,
          organizationId: true,
          organization: { select: { id: true, name: true, slug: true } },
        },
      },
      _count: { select: { rooms: true } },
    },
  });
  if (!building) throw new NotFoundError("Bâtiment introuvable");
  guard(user, building.site.organizationId, "hierarchy:read", "Bâtiment introuvable");
  return {
    id: building.id,
    siteId: building.siteId,
    name: building.name,
    code: building.code,
    createdAt: building.createdAt,
    updatedAt: building.updatedAt,
    counts: { rooms: building._count.rooms },
    site: {
      id: building.site.id,
      name: building.site.name,
      code: building.site.code,
      organizationId: building.site.organizationId,
    },
    organization: building.site.organization,
  };
}

export async function updateBuilding(
  user: AuthUser,
  buildingId: string,
  input: { name?: string; code?: string },
) {
  const current = await prisma.building.findUnique({
    where: { id: buildingId },
    include: { site: { select: { organizationId: true } } },
  });
  if (!current) throw new NotFoundError("Bâtiment introuvable");
  guard(user, current.site.organizationId, "hierarchy:write", "Bâtiment introuvable");
  try {
    const building = await prisma.building.update({
      where: { id: buildingId },
      data: {
        name: input.name?.trim(),
        code: input.code ? normalizeCode(input.code) : undefined,
      },
    });
    await recordAudit({
      actor: user,
      organizationId: current.site.organizationId,
      action: "building.update",
      resourceType: "Building",
      resourceId: building.id,
      metadata: { before: { name: current.name, code: current.code }, after: { name: building.name, code: building.code } },
    });
    return building;
  } catch (error) {
    rethrowUnique(error, "Ce code de bâtiment existe déjà sur ce site");
  }
}

export async function deleteBuilding(user: AuthUser, buildingId: string) {
  const current = await prisma.building.findUnique({
    where: { id: buildingId },
    include: { site: { select: { organizationId: true } }, _count: { select: { rooms: true, devices: true } } },
  });
  if (!current) throw new NotFoundError("Bâtiment introuvable");
  guard(user, current.site.organizationId, "hierarchy:delete", "Bâtiment introuvable");
  if (current._count.rooms > 0) {
    throw new ConflictError("Ce bâtiment contient des salles. Retirez-les avant de le supprimer.");
  }
  if (current._count.devices > 0) {
    throw new ConflictError("Ce bâtiment porte des équipements. Retirez-les avant de le supprimer.");
  }
  await recordAudit({
    actor: user,
    organizationId: current.site.organizationId,
    action: "building.delete",
    resourceType: "Building",
    resourceId: current.id,
    metadata: { name: current.name, code: current.code },
  });
  await prisma.building.delete({ where: { id: buildingId } });
  return { ok: true };
}

export async function listRooms(user: AuthUser, buildingId: string) {
  const building = await prisma.building.findUnique({
    where: { id: buildingId },
    include: { site: { select: { organizationId: true } } },
  });
  if (!building) throw new NotFoundError("Bâtiment introuvable");
  guard(user, building.site.organizationId, "hierarchy:read", "Bâtiment introuvable");
  const rooms = await prisma.room.findMany({
    where: { buildingId },
    include: { _count: { select: { racks: true } } },
    orderBy: { name: "asc" },
  });
  return {
    data: rooms.map((room) => ({
      id: room.id,
      buildingId: room.buildingId,
      name: room.name,
      code: room.code,
      createdAt: room.createdAt,
      updatedAt: room.updatedAt,
      counts: { racks: room._count.racks },
    })),
  };
}

export async function createRoom(user: AuthUser, buildingId: string, input: { name: string; code: string }) {
  const building = await prisma.building.findUnique({
    where: { id: buildingId },
    include: { site: { select: { organizationId: true } } },
  });
  if (!building) throw new NotFoundError("Bâtiment introuvable");
  guard(user, building.site.organizationId, "hierarchy:write", "Bâtiment introuvable");
  try {
    const room = await prisma.room.create({
      data: { buildingId, name: input.name.trim(), code: normalizeCode(input.code) },
    });
    await recordAudit({
      actor: user,
      organizationId: building.site.organizationId,
      action: "room.create",
      resourceType: "Room",
      resourceId: room.id,
      metadata: { name: room.name, code: room.code, buildingId },
    });
    return room;
  } catch (error) {
    rethrowUnique(error, "Ce code de salle existe déjà dans ce bâtiment");
  }
}

export async function getRoom(user: AuthUser, roomId: string) {
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    include: {
      building: {
        select: {
          id: true,
          name: true,
          code: true,
          site: {
            select: {
              id: true,
              name: true,
              code: true,
              organizationId: true,
              organization: { select: { id: true, name: true, slug: true } },
            },
          },
        },
      },
      _count: { select: { racks: true } },
    },
  });
  if (!room) throw new NotFoundError("Salle introuvable");
  guard(user, room.building.site.organizationId, "hierarchy:read", "Salle introuvable");
  return {
    id: room.id,
    buildingId: room.buildingId,
    name: room.name,
    code: room.code,
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
    counts: { racks: room._count.racks },
    building: { id: room.building.id, name: room.building.name, code: room.building.code },
    site: {
      id: room.building.site.id,
      name: room.building.site.name,
      code: room.building.site.code,
      organizationId: room.building.site.organizationId,
    },
    organization: room.building.site.organization,
  };
}

export async function updateRoom(user: AuthUser, roomId: string, input: { name?: string; code?: string }) {
  const current = await prisma.room.findUnique({
    where: { id: roomId },
    include: { building: { select: { site: { select: { organizationId: true } } } } },
  });
  if (!current) throw new NotFoundError("Salle introuvable");
  const organizationId = current.building.site.organizationId;
  guard(user, organizationId, "hierarchy:write", "Salle introuvable");
  try {
    const room = await prisma.room.update({
      where: { id: roomId },
      data: {
        name: input.name?.trim(),
        code: input.code ? normalizeCode(input.code) : undefined,
      },
    });
    await recordAudit({
      actor: user,
      organizationId,
      action: "room.update",
      resourceType: "Room",
      resourceId: room.id,
      metadata: { before: { name: current.name, code: current.code }, after: { name: room.name, code: room.code } },
    });
    return room;
  } catch (error) {
    rethrowUnique(error, "Ce code de salle existe déjà dans ce bâtiment");
  }
}

export async function deleteRoom(user: AuthUser, roomId: string) {
  const current = await prisma.room.findUnique({
    where: { id: roomId },
    include: {
      building: { select: { site: { select: { organizationId: true } } } },
      _count: { select: { racks: true, devices: true } },
    },
  });
  if (!current) throw new NotFoundError("Salle introuvable");
  const organizationId = current.building.site.organizationId;
  guard(user, organizationId, "hierarchy:delete", "Salle introuvable");
  if (current._count.racks > 0) {
    throw new ConflictError("Cette salle contient des baies. Retirez-les avant de la supprimer.");
  }
  if (current._count.devices > 0) {
    throw new ConflictError("Cette salle porte des équipements. Retirez-les avant de la supprimer.");
  }
  await recordAudit({
    actor: user,
    organizationId,
    action: "room.delete",
    resourceType: "Room",
    resourceId: current.id,
    metadata: { name: current.name, code: current.code },
  });
  await prisma.room.delete({ where: { id: roomId } });
  return { ok: true };
}

export async function listRacks(user: AuthUser, roomId: string) {
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    include: { building: { select: { site: { select: { organizationId: true } } } } },
  });
  if (!room) throw new NotFoundError("Salle introuvable");
  guard(user, room.building.site.organizationId, "hierarchy:read", "Salle introuvable");
  const racks = await prisma.rack.findMany({ where: { roomId }, orderBy: { name: "asc" } });
  return { data: racks };
}

export async function createRack(
  user: AuthUser,
  roomId: string,
  input: { name: string; code: string; heightU?: number },
) {
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    include: { building: { select: { site: { select: { organizationId: true } } } } },
  });
  if (!room) throw new NotFoundError("Salle introuvable");
  const organizationId = room.building.site.organizationId;
  guard(user, organizationId, "hierarchy:write", "Salle introuvable");
  try {
    const rack = await prisma.rack.create({
      data: {
        roomId,
        name: input.name.trim(),
        code: normalizeCode(input.code),
        heightU: input.heightU ?? 42,
      },
    });
    await recordAudit({
      actor: user,
      organizationId,
      action: "rack.create",
      resourceType: "Rack",
      resourceId: rack.id,
      metadata: { name: rack.name, code: rack.code, heightU: rack.heightU, roomId },
    });
    return rack;
  } catch (error) {
    rethrowUnique(error, "Ce code de baie existe déjà dans cette salle");
  }
}

export async function getRack(user: AuthUser, rackId: string) {
  const rack = await prisma.rack.findUnique({
    where: { id: rackId },
    include: {
      room: {
        select: {
          id: true,
          name: true,
          code: true,
          building: {
            select: {
              id: true,
              name: true,
              code: true,
              site: {
                select: {
                  id: true,
                  name: true,
                  code: true,
                  organizationId: true,
                  organization: { select: { id: true, name: true, slug: true } },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!rack) throw new NotFoundError("Baie introuvable");
  guard(user, rack.room.building.site.organizationId, "hierarchy:read", "Baie introuvable");
  return {
    id: rack.id,
    roomId: rack.roomId,
    name: rack.name,
    code: rack.code,
    heightU: rack.heightU,
    createdAt: rack.createdAt,
    updatedAt: rack.updatedAt,
    room: { id: rack.room.id, name: rack.room.name, code: rack.room.code },
    building: { id: rack.room.building.id, name: rack.room.building.name, code: rack.room.building.code },
    site: {
      id: rack.room.building.site.id,
      name: rack.room.building.site.name,
      code: rack.room.building.site.code,
      organizationId: rack.room.building.site.organizationId,
    },
    organization: rack.room.building.site.organization,
  };
}

export async function updateRack(
  user: AuthUser,
  rackId: string,
  input: { name?: string; code?: string; heightU?: number },
) {
  const current = await prisma.rack.findUnique({
    where: { id: rackId },
    include: { room: { select: { building: { select: { site: { select: { organizationId: true } } } } } } },
  });
  if (!current) throw new NotFoundError("Baie introuvable");
  const organizationId = current.room.building.site.organizationId;
  guard(user, organizationId, "hierarchy:write", "Baie introuvable");
  try {
    const rack = await prisma.rack.update({
      where: { id: rackId },
      data: {
        name: input.name?.trim(),
        code: input.code ? normalizeCode(input.code) : undefined,
        heightU: input.heightU,
      },
    });
    await recordAudit({
      actor: user,
      organizationId,
      action: "rack.update",
      resourceType: "Rack",
      resourceId: rack.id,
      metadata: {
        before: { name: current.name, code: current.code, heightU: current.heightU },
        after: { name: rack.name, code: rack.code, heightU: rack.heightU },
      },
    });
    return rack;
  } catch (error) {
    rethrowUnique(error, "Ce code de baie existe déjà dans cette salle");
  }
}

export async function deleteRack(user: AuthUser, rackId: string) {
  const current = await prisma.rack.findUnique({
    where: { id: rackId },
    include: {
      room: { select: { building: { select: { site: { select: { organizationId: true } } } } } },
      _count: { select: { devices: true } },
    },
  });
  if (!current) throw new NotFoundError("Baie introuvable");
  const organizationId = current.room.building.site.organizationId;
  guard(user, organizationId, "hierarchy:delete", "Baie introuvable");
  if (current._count.devices > 0) {
    throw new ConflictError("Cette baie contient des équipements. Retirez-les avant de la supprimer.");
  }
  await recordAudit({
    actor: user,
    organizationId,
    action: "rack.delete",
    resourceType: "Rack",
    resourceId: current.id,
    metadata: { name: current.name, code: current.code },
  });
  await prisma.rack.delete({ where: { id: rackId } });
  return { ok: true };
}
