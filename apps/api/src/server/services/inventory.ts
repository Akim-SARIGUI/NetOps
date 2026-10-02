import { Prisma, type DeviceRole, type DeviceStatus } from "../../../generated/prisma/client";
import { recordAudit } from "../audit";
import type { AuthUser } from "../auth/context";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import { prisma } from "../prisma";
import { assertPermission } from "../rbac/guard";
import { blankToNull, DEVICE_ROLES, DEVICE_STATUSES } from "../validation/network";

type LocationInput = {
  siteId: string;
  buildingId?: string | null;
  roomId?: string | null;
  rackId?: string | null;
};

type DeviceWrite = {
  role?: DeviceRole;
  hostname?: string;
  managementIp?: string | null;
  vendor?: string | null;
  model?: string | null;
  os?: string | null;
  osVersion?: string | null;
  serialNumber?: string | null;
  status?: DeviceStatus;
  description?: string | null;
} & Partial<LocationInput>;

type InterfaceWrite = {
  name?: string;
  ipAddress?: string | null;
  macAddress?: string | null;
  speedMbps?: number | null;
  duplex?: "AUTO" | "FULL" | "HALF" | null;
  status?: "UP" | "DOWN" | "ADMIN_DOWN";
  description?: string | null;
};

type DeviceQuery = {
  q?: string;
  role?: DeviceRole;
  status?: DeviceStatus;
  siteId?: string;
  buildingId?: string;
  roomId?: string;
  rackId?: string;
  vendor?: string;
  limit?: number;
};

const deviceInclude = {
  site: { select: { id: true, name: true, code: true } },
  building: { select: { id: true, name: true, code: true } },
  room: { select: { id: true, name: true, code: true } },
  rack: { select: { id: true, name: true, code: true } },
  _count: { select: { interfaces: true } },
} as const;

function uniqueMessage(error: Prisma.PrismaClientKnownRequestError): string {
  const target = Array.isArray(error.meta?.target) ? error.meta.target.join(" ") : String(error.meta?.target ?? "");
  if (target.includes("hostname")) return "Ce nom d'hôte existe déjà dans l'organisation";
  if (target.includes("management_ip")) return "Cette IP de management est déjà utilisée";
  if (target.includes("serial_number")) return "Ce numéro de série existe déjà";
  if (target.includes("name")) return "Cette interface existe déjà sur l'équipement";
  return "Cette valeur existe déjà";
}

function rethrowUnique(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    throw new ConflictError(uniqueMessage(error));
  }
  throw error;
}

function mapDevice(device: {
  id: string;
  organizationId: string;
  role: DeviceRole;
  hostname: string;
  managementIp: string | null;
  vendor: string | null;
  model: string | null;
  os: string | null;
  osVersion: string | null;
  serialNumber: string | null;
  status: DeviceStatus;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
  site: { id: string; name: string; code: string };
  building: { id: string; name: string; code: string } | null;
  room: { id: string; name: string; code: string } | null;
  rack: { id: string; name: string; code: string } | null;
  _count: { interfaces: number };
}) {
  return {
    id: device.id,
    organizationId: device.organizationId,
    role: device.role,
    hostname: device.hostname,
    managementIp: device.managementIp,
    vendor: device.vendor,
    model: device.model,
    os: device.os,
    osVersion: device.osVersion,
    serialNumber: device.serialNumber,
    status: device.status,
    description: device.description,
    createdAt: device.createdAt,
    updatedAt: device.updatedAt,
    site: device.site,
    building: device.building,
    room: device.room,
    rack: device.rack,
    counts: { interfaces: device._count.interfaces },
  };
}

async function requireOrganization(user: AuthUser, organizationId: string, permission: "inventory:read" | "inventory:write" | "inventory:delete") {
  const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true } });
  if (!organization) throw new NotFoundError("Organisation introuvable");
  assertPermission(user, organizationId, permission, "Organisation introuvable");
}

async function resolveLocation(organizationId: string, input: LocationInput) {
  const site = await prisma.site.findUnique({ where: { id: input.siteId }, select: { id: true, organizationId: true } });
  if (!site || site.organizationId !== organizationId) {
    throw new NotFoundError("Site introuvable");
  }

  let buildingId: string | null = input.buildingId ?? null;
  let roomId: string | null = input.roomId ?? null;
  let rackId: string | null = input.rackId ?? null;

  if (!buildingId) {
    roomId = null;
    rackId = null;
  }
  if (!roomId) rackId = null;

  if (buildingId) {
    const building = await prisma.building.findUnique({ where: { id: buildingId }, select: { id: true, siteId: true } });
    if (!building || building.siteId !== site.id) {
      throw new ValidationError([{ path: "buildingId", message: "Le bâtiment n'appartient pas à ce site" }]);
    }
  }
  if (roomId) {
    const room = await prisma.room.findUnique({ where: { id: roomId }, select: { id: true, buildingId: true } });
    if (!room || room.buildingId !== buildingId) {
      throw new ValidationError([{ path: "roomId", message: "La salle n'appartient pas à ce bâtiment" }]);
    }
  }
  if (rackId) {
    const rack = await prisma.rack.findUnique({ where: { id: rackId }, select: { id: true, roomId: true } });
    if (!rack || rack.roomId !== roomId) {
      throw new ValidationError([{ path: "rackId", message: "La baie n'appartient pas à cette salle" }]);
    }
  }

  return { siteId: site.id, buildingId, roomId, rackId };
}

async function assertManagementIp(organizationId: string, ip: string | null | undefined, deviceId?: string) {
  if (!ip) return;
  const device = await prisma.device.findFirst({
    where: { organizationId, managementIp: ip, ...(deviceId ? { id: { not: deviceId } } : {}) },
    select: { hostname: true },
  });
  if (device) throw new ConflictError(`L'adresse ${ip} est déjà l'IP de management de ${device.hostname}`);
  const networkInterface = await prisma.networkInterface.findFirst({
    where: { ipAddress: ip, device: { organizationId, ...(deviceId ? { id: { not: deviceId } } : {}) } },
    select: { name: true, device: { select: { hostname: true } } },
  });
  if (networkInterface) {
    throw new ConflictError(`L'adresse ${ip} est déjà portée par ${networkInterface.name} sur ${networkInterface.device.hostname}`);
  }
  const allocated = await prisma.ipAddress.findFirst({
    where: { organizationId, address: ip, ...(deviceId ? { NOT: { interface: { deviceId } } } : {}) },
    select: { role: true },
  });
  if (allocated) throw new ConflictError(`L'adresse ${ip} est déjà enregistrée dans l'adressage`);
}

async function assertInterfaceIp(organizationId: string, deviceId: string, ip: string | null | undefined, interfaceId?: string) {
  if (!ip) return;
  const device = await prisma.device.findFirst({
    where: { organizationId, managementIp: ip, id: { not: deviceId } },
    select: { hostname: true },
  });
  if (device) throw new ConflictError(`L'adresse ${ip} est déjà l'IP de management de ${device.hostname}`);
  const networkInterface = await prisma.networkInterface.findFirst({
    where: {
      ipAddress: ip,
      device: { organizationId },
      ...(interfaceId ? { id: { not: interfaceId } } : {}),
    },
    select: { name: true, device: { select: { hostname: true } } },
  });
  if (networkInterface) {
    throw new ConflictError(`L'adresse ${ip} est déjà portée par ${networkInterface.name} sur ${networkInterface.device.hostname}`);
  }
  const allocated = await prisma.ipAddress.findFirst({
    where: { organizationId, address: ip, ...(interfaceId ? { NOT: { interfaceId } } : {}) },
    select: { id: true },
  });
  if (allocated) throw new ConflictError(`L'adresse ${ip} est déjà enregistrée dans l'adressage`);
}

async function assertMacAvailable(organizationId: string, mac: string | null | undefined, exceptInterfaceId?: string) {
  if (!mac) return;
  const existing = await prisma.networkInterface.findFirst({
    where: {
      macAddress: mac,
      device: { organizationId },
      ...(exceptInterfaceId ? { id: { not: exceptInterfaceId } } : {}),
    },
    select: { name: true, device: { select: { hostname: true } } },
  });
  if (existing) {
    throw new ConflictError(`Cette adresse MAC est déjà utilisée par ${existing.name} sur ${existing.device.hostname}`);
  }
  const port = await prisma.switchPort.findFirst({
    where: { macAddress: mac, device: { organizationId } },
    select: { name: true, device: { select: { hostname: true } } },
  });
  if (port) {
    throw new ConflictError(`Cette adresse MAC est déjà utilisée par ${port.name} sur ${port.device.hostname}`);
  }
}

async function assertFilter(organizationId: string, kind: "site" | "building" | "room" | "rack", id: string) {
  const found =
    kind === "site"
      ? await prisma.site.findFirst({ where: { id, organizationId }, select: { id: true } })
      : kind === "building"
        ? await prisma.building.findFirst({ where: { id, site: { organizationId } }, select: { id: true } })
        : kind === "room"
          ? await prisma.room.findFirst({
              where: { id, building: { site: { organizationId } } },
              select: { id: true },
            })
          : await prisma.rack.findFirst({
              where: { id, room: { building: { site: { organizationId } } } },
              select: { id: true },
            });
  if (!found) {
    const label = kind === "site" ? "Site" : kind === "building" ? "Bâtiment" : kind === "room" ? "Salle" : "Baie";
    throw new NotFoundError(`${label} introuvable`);
  }
}

function text(value: string | null | undefined) {
  return blankToNull(value);
}

export async function inventorySummary(user: AuthUser, organizationId: string) {
  await requireOrganization(user, organizationId, "inventory:read");
  const [byRole, byStatus, interfaces] = await Promise.all([
    prisma.device.groupBy({ by: ["role"], where: { organizationId }, _count: { _all: true } }),
    prisma.device.groupBy({ by: ["status"], where: { organizationId }, _count: { _all: true } }),
    prisma.networkInterface.count({ where: { device: { organizationId } } }),
  ]);

  const roles = Object.fromEntries(DEVICE_ROLES.map((role) => [role, 0])) as Record<DeviceRole, number>;
  const statuses = Object.fromEntries(DEVICE_STATUSES.map((status) => [status, 0])) as Record<DeviceStatus, number>;
  for (const row of byRole) roles[row.role] = row._count._all;
  for (const row of byStatus) statuses[row.status] = row._count._all;

  return {
    devices: Object.values(roles).reduce((total, count) => total + count, 0),
    interfaces,
    byRole: roles,
    byStatus: statuses,
  };
}

export async function listDevices(user: AuthUser, organizationId: string, query: DeviceQuery) {
  await requireOrganization(user, organizationId, "inventory:read");
  if (query.siteId) await assertFilter(organizationId, "site", query.siteId);
  if (query.buildingId) await assertFilter(organizationId, "building", query.buildingId);
  if (query.roomId) await assertFilter(organizationId, "room", query.roomId);
  if (query.rackId) await assertFilter(organizationId, "rack", query.rackId);

  const term = query.q?.trim();
  const devices = await prisma.device.findMany({
    where: {
      organizationId,
      role: query.role,
      status: query.status,
      siteId: query.siteId,
      buildingId: query.buildingId,
      roomId: query.roomId,
      rackId: query.rackId,
      vendor: query.vendor ? { equals: query.vendor, mode: "insensitive" } : undefined,
      ...(term
        ? {
            OR: [
              { hostname: { contains: term, mode: "insensitive" } },
              { managementIp: { contains: term, mode: "insensitive" } },
              { serialNumber: { contains: term, mode: "insensitive" } },
              { vendor: { contains: term, mode: "insensitive" } },
              { model: { contains: term, mode: "insensitive" } },
              { os: { contains: term, mode: "insensitive" } },
              { description: { contains: term, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    include: deviceInclude,
    orderBy: [{ role: "asc" }, { hostname: "asc" }],
    take: query.limit ?? 100,
  });
  return { data: devices.map(mapDevice) };
}

export async function listRackDevices(user: AuthUser, rackId: string) {
  const rack = await prisma.rack.findUnique({
    where: { id: rackId },
    select: { id: true, room: { select: { building: { select: { site: { select: { organizationId: true } } } } } } },
  });
  if (!rack) throw new NotFoundError("Baie introuvable");
  return listDevices(user, rack.room.building.site.organizationId, { rackId });
}

export async function createDevice(user: AuthUser, organizationId: string, input: DeviceWrite & LocationInput) {
  await requireOrganization(user, organizationId, "inventory:write");
  const location = await resolveLocation(organizationId, input);
  const managementIp = text(input.managementIp) ?? null;
  await assertManagementIp(organizationId, managementIp);
  try {
    const device = await prisma.device.create({
      data: {
        organizationId,
        ...location,
        role: input.role!,
        hostname: input.hostname!,
        managementIp,
        vendor: text(input.vendor) ?? null,
        model: text(input.model) ?? null,
        os: text(input.os) ?? null,
        osVersion: text(input.osVersion) ?? null,
        serialNumber: text(input.serialNumber) ?? null,
        status: input.status ?? "PLANNED",
        description: text(input.description) ?? null,
      },
      include: deviceInclude,
    });
    await recordAudit({
      actor: user,
      organizationId,
      action: "device.create",
      resourceType: "Device",
      resourceId: device.id,
      metadata: { hostname: device.hostname, role: device.role, siteId: device.site.id },
    });
    return mapDevice(device);
  } catch (error) {
    rethrowUnique(error);
  }
}

export async function getDevice(user: AuthUser, deviceId: string) {
  const device = await prisma.device.findUnique({
    where: { id: deviceId },
    include: {
      ...deviceInclude,
      interfaces: { orderBy: { name: "asc" } },
      organization: { select: { id: true, name: true, slug: true } },
    },
  });
  if (!device) throw new NotFoundError("Équipement introuvable");
  assertPermission(user, device.organizationId, "inventory:read", "Équipement introuvable");
  return {
    ...mapDevice(device),
    organization: device.organization,
    interfaces: device.interfaces,
  };
}

export async function updateDevice(user: AuthUser, deviceId: string, input: DeviceWrite) {
  const current = await prisma.device.findUnique({ where: { id: deviceId } });
  if (!current) throw new NotFoundError("Équipement introuvable");
  assertPermission(user, current.organizationId, "inventory:write", "Équipement introuvable");

  const locationTouched = ["siteId", "buildingId", "roomId", "rackId"].some((key) => key in input);
  const location = locationTouched
    ? await resolveLocation(current.organizationId, {
        siteId: input.siteId ?? current.siteId,
        buildingId: input.buildingId !== undefined ? input.buildingId : current.buildingId,
        roomId: input.roomId !== undefined ? input.roomId : current.roomId,
        rackId: input.rackId !== undefined ? input.rackId : current.rackId,
      })
    : null;

  const managementIp = input.managementIp !== undefined ? (text(input.managementIp) ?? null) : undefined;
  if (managementIp) await assertManagementIp(current.organizationId, managementIp, deviceId);

  const nextRole = input.role ?? current.role;
  if (nextRole !== "SWITCH") {
    const ports = await prisma.switchPort.count({ where: { deviceId } });
    if (ports > 0) {
      throw new ConflictError("Ce commutateur a des ports. Retirez-les avant de changer son rôle.");
    }
  }

  if (location && location.siteId !== current.siteId) {
    const bound = await prisma.switchPort.count({
      where: {
        deviceId,
        OR: [
          { accessVlan: { siteId: { not: location.siteId } } },
          { nativeVlan: { siteId: { not: location.siteId } } },
          { allowedVlans: { some: { vlan: { siteId: { not: location.siteId } } } } },
        ],
      },
    });
    if (bound > 0) {
      throw new ConflictError("Des ports référencent des VLAN de l'ancien site. Retirez ces affectations avant de déplacer le commutateur.");
    }
  }

  try {
    const device = await prisma.device.update({
      where: { id: deviceId },
      data: {
        ...(location ?? {}),
        role: input.role,
        hostname: input.hostname,
        managementIp,
        vendor: input.vendor !== undefined ? (text(input.vendor) ?? null) : undefined,
        model: input.model !== undefined ? (text(input.model) ?? null) : undefined,
        os: input.os !== undefined ? (text(input.os) ?? null) : undefined,
        osVersion: input.osVersion !== undefined ? (text(input.osVersion) ?? null) : undefined,
        serialNumber: input.serialNumber !== undefined ? (text(input.serialNumber) ?? null) : undefined,
        status: input.status,
        description: input.description !== undefined ? (text(input.description) ?? null) : undefined,
      },
      include: deviceInclude,
    });
    await recordAudit({
      actor: user,
      organizationId: current.organizationId,
      action: "device.update",
      resourceType: "Device",
      resourceId: device.id,
      metadata: {
        before: { hostname: current.hostname, role: current.role, status: current.status, managementIp: current.managementIp },
        after: { hostname: device.hostname, role: device.role, status: device.status, managementIp: device.managementIp },
      },
    });
    return mapDevice(device);
  } catch (error) {
    rethrowUnique(error);
  }
}

export async function deleteDevice(user: AuthUser, deviceId: string) {
  const current = await prisma.device.findUnique({
    where: { id: deviceId },
    include: { _count: { select: { interfaces: true, switchPorts: true, connectedPorts: true, dhcpServers: true, dnsServers: true, layer3Interfaces: true, routes: true, acls: true } } },
  });
  if (!current) throw new NotFoundError("Équipement introuvable");
  assertPermission(user, current.organizationId, "inventory:delete", "Équipement introuvable");
  const ospfProcess = await prisma.ospfProcess.count({ where: { deviceId: current.id } });
  if (current._count.interfaces > 0) {
    throw new ConflictError("Cet équipement a des interfaces. Retirez-les avant de le supprimer.");
  }
  if (current._count.switchPorts > 0) {
    throw new ConflictError("Ce commutateur a des ports. Retirez-les avant de le supprimer.");
  }
  if (current._count.connectedPorts > 0) {
    throw new ConflictError("Cet équipement est raccordé à un port de commutateur. Retirez le raccordement avant de le supprimer.");
  }
  if (current._count.dhcpServers > 0) {
    throw new ConflictError("Cet équipement porte un serveur DHCP. Retirez-le avant de supprimer l'équipement.");
  }
  if (current._count.dnsServers > 0) {
    throw new ConflictError("Cet équipement porte un serveur DNS. Retirez-le avant de supprimer l'équipement.");
  }
  if (current._count.layer3Interfaces > 0 || current._count.routes > 0 || ospfProcess > 0) {
    throw new ConflictError("Cet équipement porte une table de routage. Retirez-la avant de le supprimer.");
  }
  if (current._count.acls > 0) {
    throw new ConflictError("Cet équipement porte une ACL. Retirez-la avant de supprimer l'équipement.");
  }
  const topologyLinks = await prisma.topologyLink.count({ where: { OR: [{ sourceDeviceId: current.id }, { targetDeviceId: current.id }] } });
  if (topologyLinks > 0) {
    throw new ConflictError("Cet équipement porte un lien de topologie. Retirez-le avant de supprimer l'équipement.");
  }
  const monitoringTargets = await prisma.monitoringTarget.count({ where: { deviceId: current.id } });
  if (monitoringTargets > 0) {
    throw new ConflictError("Cet équipement est supervisé. Retirez la cible avant de supprimer l'équipement.");
  }
  const discoveryMentions = await prisma.discoveryFinding.count({
    where: { OR: [{ matchedDeviceId: current.id }, { importedDeviceId: current.id }] },
  });
  if (discoveryMentions > 0) {
    throw new ConflictError("Cet équipement est cité par une découverte. Retirez le dossier avant de supprimer l'équipement.");
  }
  const automationJobs = await prisma.automationJob.count({ where: { deviceId: current.id } });
  if (automationJobs > 0) {
    throw new ConflictError("Cet équipement a un travail d'automatisation. Retirez-le avant de supprimer l'équipement.");
  }
  const changeRequests = await prisma.changeRequest.count({ where: { deviceId: current.id } });
  if (changeRequests > 0) {
    throw new ConflictError("Cet équipement a une demande de changement. Retirez-la avant de supprimer l'équipement.");
  }
  const diagnosticSessions = await prisma.diagnosticSession.count({ where: { deviceId: current.id } });
  if (diagnosticSessions > 0) {
    throw new ConflictError("Cet équipement a un diagnostic enregistré. Retirez-le avant de supprimer l'équipement.");
  }
  await recordAudit({
    actor: user,
    organizationId: current.organizationId,
    action: "device.delete",
    resourceType: "Device",
    resourceId: current.id,
    metadata: { hostname: current.hostname, role: current.role },
  });
  await prisma.device.delete({ where: { id: deviceId } });
  return { ok: true };
}

async function loadDeviceForInterface(deviceId: string) {
  const device = await prisma.device.findUnique({
    where: { id: deviceId },
    select: { id: true, organizationId: true, hostname: true },
  });
  if (!device) throw new NotFoundError("Équipement introuvable");
  return device;
}

export async function listInterfaces(user: AuthUser, deviceId: string, query: { q?: string }) {
  const device = await loadDeviceForInterface(deviceId);
  assertPermission(user, device.organizationId, "inventory:read", "Équipement introuvable");
  const term = query.q?.trim();
  const interfaces = await prisma.networkInterface.findMany({
    where: {
      deviceId,
      ...(term
        ? {
            OR: [
              { name: { contains: term, mode: "insensitive" } },
              { ipAddress: { contains: term, mode: "insensitive" } },
              { macAddress: { contains: term, mode: "insensitive" } },
              { description: { contains: term, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: { name: "asc" },
  });
  return { data: interfaces };
}

export async function createInterface(user: AuthUser, deviceId: string, input: InterfaceWrite) {
  const device = await loadDeviceForInterface(deviceId);
  assertPermission(user, device.organizationId, "inventory:write", "Équipement introuvable");
  const ipAddress = text(input.ipAddress) ?? null;
  const macAddress = input.macAddress ?? null;
  await assertInterfaceIp(device.organizationId, device.id, ipAddress);
  await assertMacAvailable(device.organizationId, macAddress);
  try {
    const networkInterface = await prisma.networkInterface.create({
      data: {
        deviceId,
        name: input.name!,
        ipAddress,
        macAddress,
        speedMbps: input.speedMbps ?? null,
        duplex: input.duplex ?? null,
        status: input.status ?? "DOWN",
        description: text(input.description) ?? null,
      },
    });
    await recordAudit({
      actor: user,
      organizationId: device.organizationId,
      action: "interface.create",
      resourceType: "NetworkInterface",
      resourceId: networkInterface.id,
      metadata: { device: device.hostname, name: networkInterface.name, ipAddress: networkInterface.ipAddress },
    });
    return networkInterface;
  } catch (error) {
    rethrowUnique(error);
  }
}

export async function getInterface(user: AuthUser, interfaceId: string) {
  const networkInterface = await prisma.networkInterface.findUnique({
    where: { id: interfaceId },
    include: { device: { select: { id: true, hostname: true, organizationId: true, role: true } } },
  });
  if (!networkInterface) throw new NotFoundError("Interface introuvable");
  assertPermission(user, networkInterface.device.organizationId, "inventory:read", "Interface introuvable");
  return networkInterface;
}

export async function updateInterface(user: AuthUser, interfaceId: string, input: InterfaceWrite) {
  const current = await prisma.networkInterface.findUnique({
    where: { id: interfaceId },
    include: { device: { select: { id: true, hostname: true, organizationId: true } } },
  });
  if (!current) throw new NotFoundError("Interface introuvable");
  assertPermission(user, current.device.organizationId, "inventory:write", "Interface introuvable");
  const ipAddress = input.ipAddress !== undefined ? (text(input.ipAddress) ?? null) : undefined;
  const macAddress = input.macAddress !== undefined ? input.macAddress : undefined;
  if (ipAddress) await assertInterfaceIp(current.device.organizationId, current.device.id, ipAddress, interfaceId);
  if (ipAddress !== undefined) {
    const allocation = await prisma.ipAddress.findUnique({ where: { interfaceId }, select: { address: true } });
    if (allocation && ipAddress !== allocation.address) {
      throw new ConflictError(`Cette interface est liée à l'allocation ${allocation.address}. Modifiez-la dans l'adressage.`);
    }
  }
  if (macAddress) await assertMacAvailable(current.device.organizationId, macAddress, interfaceId);
  try {
    const networkInterface = await prisma.networkInterface.update({
      where: { id: interfaceId },
      data: {
        name: input.name,
        ipAddress,
        macAddress,
        speedMbps: input.speedMbps,
        duplex: input.duplex,
        status: input.status,
        description: input.description !== undefined ? (text(input.description) ?? null) : undefined,
      },
    });
    await recordAudit({
      actor: user,
      organizationId: current.device.organizationId,
      action: "interface.update",
      resourceType: "NetworkInterface",
      resourceId: networkInterface.id,
      metadata: {
        device: current.device.hostname,
        before: { name: current.name, ipAddress: current.ipAddress, status: current.status },
        after: { name: networkInterface.name, ipAddress: networkInterface.ipAddress, status: networkInterface.status },
      },
    });
    return networkInterface;
  } catch (error) {
    rethrowUnique(error);
  }
}

export async function deleteInterface(user: AuthUser, interfaceId: string) {
  const current = await prisma.networkInterface.findUnique({
    where: { id: interfaceId },
    include: { device: { select: { hostname: true, organizationId: true } }, ipAllocation: { select: { address: true } }, _count: { select: { dhcpRelays: true, layer3Children: true } } },
  });
  if (!current) throw new NotFoundError("Interface introuvable");
  assertPermission(user, current.device.organizationId, "inventory:delete", "Interface introuvable");
  if (current.ipAllocation) {
    throw new ConflictError(`Cette interface porte l'allocation ${current.ipAllocation.address}. Retirez-la dans l'adressage avant de supprimer l'interface.`);
  }
  if (current._count.dhcpRelays > 0) {
    throw new ConflictError("Cette interface porte un relais DHCP. Retirez-le avant de supprimer l'interface.");
  }
  if (current._count.layer3Children > 0) {
    throw new ConflictError("Cette interface porte une interface de routage. Retirez-la avant de supprimer l'interface.");
  }
  await recordAudit({
    actor: user,
    organizationId: current.device.organizationId,
    action: "interface.delete",
    resourceType: "NetworkInterface",
    resourceId: current.id,
    metadata: { device: current.device.hostname, name: current.name },
  });
  await prisma.networkInterface.delete({ where: { id: interfaceId } });
  return { ok: true };
}
