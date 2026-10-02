import { Prisma } from "../../../generated/prisma/client";
import { recordAudit } from "../audit";
import type { AuthUser } from "../auth/context";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import { parseAddress, parsePrefix, summarize } from "../ipam/address";
import { prisma } from "../prisma";
import { assertPermission } from "../rbac/guard";
import { fabricIssues } from "../switching/fabric";
import { isStructuralIssue, issuesForPort, issuesForSwitch, renderSwitchTree, type PortSnapshot, type VlanRef } from "../switching/rules";
import { blankToNull } from "../validation/network";
import { attachSubnetToVlan } from "./ipam";

type VlanWrite = {
  siteId?: string;
  vid?: number;
  name?: string;
  description?: string | null;
  role?: "DATA" | "VOICE" | "MANAGEMENT" | "GUEST" | "SERVER" | "TRANSIT" | "NATIVE";
  securityZone?: "TRUST" | "UNTRUST" | "DMZ" | "GUEST" | "MANAGEMENT" | "INTERNAL";
  status?: "ACTIVE" | "PLANNED" | "RESERVED" | "DEPRECATED";
};

type PortWrite = {
  name?: string;
  status?: "UP" | "DOWN" | "ADMIN_DOWN" | "ERR_DISABLED";
  mode?: "ACCESS" | "TRUNK";
  accessVlanId?: string | null;
  nativeVlanId?: string | null;
  allowedVlanIds?: string[];
  speedMbps?: number | null;
  duplex?: "AUTO" | "FULL" | "HALF" | null;
  description?: string | null;
  connectedDeviceId?: string | null;
  macAddress?: string | null;
  poe?: "OFF" | "ON" | "FAULT";
};

const portInclude = {
  accessVlan: true,
  nativeVlan: true,
  allowedVlans: { include: { vlan: true } },
  connectedDevice: { select: { id: true, hostname: true, role: true, organizationId: true } },
  device: { select: { id: true, hostname: true, role: true, siteId: true, organizationId: true } },
} as const;

function rethrowUnique(error: unknown, fallback: string): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    const target = Array.isArray(error.meta?.target) ? error.meta.target.join(" ") : String(error.meta?.target ?? "");
    if (target.includes("vid")) throw new ConflictError("Ce VLAN ID existe déjà sur ce site");
    if (target.includes("name") && target.includes("site")) throw new ConflictError("Ce nom de VLAN existe déjà sur ce site");
    if (target.includes("name")) throw new ConflictError("Ce port existe déjà sur le commutateur");
    throw new ConflictError(fallback);
  }
  throw error;
}

function toVlanRef(vlan: { id: string; vid: number; siteId: string; status: string; name: string } | null): VlanRef | null {
  if (!vlan) return null;
  return { id: vlan.id, vid: vlan.vid, siteId: vlan.siteId, status: vlan.status, name: vlan.name };
}

function snapshot(port: {
  id: string;
  name: string;
  mode: "ACCESS" | "TRUNK";
  status: string;
  poe: string;
  macAddress: string | null;
  deviceId: string;
  accessVlan: { id: string; vid: number; siteId: string; status: string; name: string } | null;
  nativeVlan: { id: string; vid: number; siteId: string; status: string; name: string } | null;
  allowedVlans: { vlan: { id: string; vid: number; siteId: string; status: string; name: string } }[];
  connectedDeviceId: string | null;
  connectedDevice: { id: string; organizationId: string } | null;
  device: { id: string; role: string; siteId: string; organizationId: string };
}): PortSnapshot {
  return {
    id: port.id,
    name: port.name,
    mode: port.mode,
    status: port.status,
    poe: port.poe,
    macAddress: port.macAddress,
    deviceId: port.deviceId,
    deviceRole: port.device.role,
    deviceSiteId: port.device.siteId,
    deviceOrganizationId: port.device.organizationId,
    accessVlan: toVlanRef(port.accessVlan),
    nativeVlan: toVlanRef(port.nativeVlan),
    allowedVlans: port.allowedVlans.map((link) => toVlanRef(link.vlan)!),
    connectedDeviceId: port.connectedDeviceId,
    connectedOrganizationId: port.connectedDevice?.organizationId ?? null,
  };
}

function assertWritable(snapshotPort: PortSnapshot) {
  const structural = issuesForPort(snapshotPort).filter((issue) => isStructuralIssue(issue.code));
  if (structural.length > 0) {
    throw new ValidationError(structural.map((issue) => ({ path: "mode", message: issue.message })));
  }
}

function mapVlan(vlan: {
  id: string;
  siteId: string;
  vid: number;
  name: string;
  description: string | null;
  role: string;
  securityZone: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  site?: { id: string; name: string; code: string };
  subnets?: { id: string; cidr: string; gatewayAddress: { address: string } | null }[];
  _count?: { accessPorts: number; nativePorts: number; trunkPorts: number };
}) {
  const usage = vlan._count
    ? vlan._count.accessPorts + vlan._count.nativePorts + vlan._count.trunkPorts
    : undefined;
  return {
    ...vlan,
    usage,
    subnets: (vlan.subnets ?? []).map((subnet) => ({
      id: subnet.id,
      cidr: subnet.cidr,
      gateway: subnet.gatewayAddress?.address ?? null,
    })),
  };
}

function mapPort(port: {
  id: string;
  deviceId: string;
  name: string;
  status: string;
  mode: "ACCESS" | "TRUNK";
  speedMbps: number | null;
  duplex: string | null;
  description: string | null;
  macAddress: string | null;
  poe: string;
  createdAt: Date;
  updatedAt: Date;
  accessVlan: { id: string; vid: number; name: string; siteId: string; status: string } | null;
  nativeVlan: { id: string; vid: number; name: string; siteId: string; status: string } | null;
  allowedVlans: { vlan: { id: string; vid: number; name: string; siteId: string; status: string } }[];
  connectedDevice: { id: string; hostname: string; role: string } | null;
}) {
  return {
    id: port.id,
    deviceId: port.deviceId,
    name: port.name,
    status: port.status,
    mode: port.mode,
    speedMbps: port.speedMbps,
    duplex: port.duplex,
    description: port.description,
    macAddress: port.macAddress,
    poe: port.poe,
    createdAt: port.createdAt,
    updatedAt: port.updatedAt,
    accessVlan: port.accessVlan,
    nativeVlan: port.nativeVlan,
    allowedVlans: port.allowedVlans.map((link) => link.vlan).sort((left, right) => left.vid - right.vid),
    connectedDevice: port.connectedDevice,
  };
}

async function requireOrganization(user: AuthUser, organizationId: string, permission: "inventory:read" | "inventory:write" | "inventory:delete") {
  const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true } });
  if (!organization) throw new NotFoundError("Organisation introuvable");
  assertPermission(user, organizationId, permission, "Organisation introuvable");
}

async function loadSwitch(user: AuthUser, deviceId: string, permission: "inventory:read" | "inventory:write" | "inventory:delete") {
  const device = await prisma.device.findUnique({
    where: { id: deviceId },
    select: {
      id: true,
      hostname: true,
      role: true,
      siteId: true,
      organizationId: true,
      site: { select: { id: true, name: true, code: true } },
    },
  });
  if (!device) throw new NotFoundError("Équipement introuvable");
  assertPermission(user, device.organizationId, permission, "Équipement introuvable");
  if (device.role !== "SWITCH") throw new ConflictError("Cet équipement n'est pas un commutateur");
  return device;
}

async function vlansOnSite(siteId: string, ids: string[]) {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const vlans = await prisma.vlan.findMany({ where: { id: { in: unique }, siteId } });
  if (vlans.length !== unique.length) {
    throw new ValidationError([{ path: "accessVlanId", message: "Un VLAN est introuvable sur le site du commutateur" }]);
  }
  return vlans;
}

async function assertMacAvailable(organizationId: string, mac: string | null | undefined, exceptPortId?: string) {
  if (!mac) return;
  const port = await prisma.switchPort.findFirst({
    where: { macAddress: mac, device: { organizationId }, ...(exceptPortId ? { id: { not: exceptPortId } } : {}) },
    select: { name: true, device: { select: { hostname: true } } },
  });
  if (port) throw new ConflictError(`Cette adresse MAC est déjà utilisée par ${port.name} sur ${port.device.hostname}`);
  const networkInterface = await prisma.networkInterface.findFirst({
    where: { macAddress: mac, device: { organizationId } },
    select: { name: true, device: { select: { hostname: true } } },
  });
  if (networkInterface) {
    throw new ConflictError(`Cette adresse MAC est déjà utilisée par ${networkInterface.name} sur ${networkInterface.device.hostname}`);
  }
}

async function assertConnectedDevice(organizationId: string, switchId: string, connectedDeviceId: string | null | undefined) {
  if (!connectedDeviceId) return;
  if (connectedDeviceId === switchId) {
    throw new ValidationError([{ path: "connectedDeviceId", message: "Un port ne peut pas être connecté à son propre commutateur" }]);
  }
  const device = await prisma.device.findFirst({ where: { id: connectedDeviceId, organizationId }, select: { id: true } });
  if (!device) throw new NotFoundError("Équipement connecté introuvable");
}

async function assertVlanName(siteId: string, name: string, exceptId?: string) {
  const existing = await prisma.vlan.findFirst({
    where: { siteId, name: { equals: name, mode: "insensitive" }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  if (existing) throw new ConflictError("Ce nom de VLAN existe déjà sur ce site");
}

export async function listVlans(
  user: AuthUser,
  organizationId: string,
  query: { q?: string; siteId?: string; role?: VlanWrite["role"]; status?: VlanWrite["status"]; securityZone?: VlanWrite["securityZone"]; limit?: number },
) {
  await requireOrganization(user, organizationId, "inventory:read");
  if (query.siteId) {
    const site = await prisma.site.findFirst({ where: { id: query.siteId, organizationId }, select: { id: true } });
    if (!site) throw new NotFoundError("Site introuvable");
  }
  const term = query.q?.trim();
  const vlans = await prisma.vlan.findMany({
    where: {
      site: { organizationId },
      siteId: query.siteId,
      role: query.role,
      status: query.status,
      securityZone: query.securityZone,
      ...(term
        ? {
            OR: [
              { name: { contains: term, mode: "insensitive" } },
              { description: { contains: term, mode: "insensitive" } },
              ...(/^\d+$/.test(term) ? [{ vid: Number(term) }] : []),
            ],
          }
        : {}),
    },
    include: {
      site: { select: { id: true, name: true, code: true } },
      subnets: { select: { id: true, cidr: true, gatewayAddress: { select: { address: true } } } },
      _count: { select: { accessPorts: true, nativePorts: true, trunkPorts: true } },
    },
    orderBy: [{ vid: "asc" }],
    take: query.limit ?? 200,
  });
  return { data: vlans.map(mapVlan) };
}

export async function createVlan(user: AuthUser, organizationId: string, input: VlanWrite & { siteId: string; vid: number; name: string; role: NonNullable<VlanWrite["role"]>; securityZone: NonNullable<VlanWrite["securityZone"]>; cidr?: string; gateway?: string }) {
  await requireOrganization(user, organizationId, "inventory:write");
  const site = await prisma.site.findFirst({ where: { id: input.siteId, organizationId }, select: { id: true } });
  if (!site) throw new NotFoundError("Site introuvable");
  await assertVlanName(site.id, input.name.trim());
  try {
    const vlan = await prisma.vlan.create({
      data: {
        siteId: site.id,
        vid: input.vid,
        name: input.name.trim(),
        description: blankToNull(input.description) ?? null,
        role: input.role,
        securityZone: input.securityZone,
        status: input.status ?? "ACTIVE",
      },
      include: { site: { select: { id: true, name: true, code: true } }, _count: { select: { accessPorts: true, nativePorts: true, trunkPorts: true } } },
    });
    if (input.cidr && input.gateway) {
      try {
        await attachSubnetToVlan(user, organizationId, vlan, { cidr: input.cidr, gateway: input.gateway });
      } catch (error) {
        await prisma.vlan.delete({ where: { id: vlan.id } }).catch(() => undefined);
        throw error;
      }
    }
    await recordAudit({
      actor: user,
      organizationId,
      action: "vlan.create",
      resourceType: "Vlan",
      resourceId: vlan.id,
      metadata: { vid: vlan.vid, name: vlan.name, siteId: vlan.siteId, cidr: input.cidr ?? null, gateway: input.gateway ?? null },
    });
    return mapVlan(vlan);
  } catch (error) {
    rethrowUnique(error, "Ce VLAN existe déjà");
  }
}

export async function getVlanFabric(user: AuthUser, vlanId: string) {
  const vlan = await prisma.vlan.findUnique({
    where: { id: vlanId },
    include: {
      site: { select: { id: true, name: true, code: true, organizationId: true } },
      subnets: {
        include: {
          gatewayAddress: { include: { interface: { select: { id: true, name: true, device: { select: { id: true, hostname: true, siteId: true } } } } } },
          addresses: { include: { interface: { select: { id: true, name: true, device: { select: { id: true, hostname: true, siteId: true, role: true } } } } } },
        },
        orderBy: { cidr: "asc" },
      },
    },
  });
  if (!vlan) throw new NotFoundError("VLAN introuvable");
  assertPermission(user, vlan.site.organizationId, "inventory:read", "VLAN introuvable");
  const ports = await prisma.switchPort.findMany({
    where: {
      OR: [{ accessVlanId: vlan.id }, { nativeVlanId: vlan.id }, { allowedVlans: { some: { vlanId: vlan.id } } }],
    },
    include: {
      device: { select: { id: true, hostname: true, siteId: true, role: true } },
      connectedDevice: {
        select: {
          id: true,
          hostname: true,
          siteId: true,
          role: true,
          managementIp: true,
          interfaces: { select: { ipAddress: true } },
        },
      },
    },
    orderBy: [{ device: { hostname: "asc" } }, { name: "asc" }],
  });
  const siblings = await prisma.ipSubnet.findMany({
    where: { vlanId: { not: vlan.id }, network: { organizationId: vlan.site.organizationId } },
    select: { name: true, cidr: true },
  });
  const switches = [...new Map(ports.map((port) => [port.device.id, port.device])).values()];
  const equipment = new Map<string, { id: string; hostname: string; role: string; via: string }>();
  for (const port of ports) {
    if (!port.connectedDevice) continue;
    equipment.set(port.connectedDevice.id, {
      id: port.connectedDevice.id,
      hostname: port.connectedDevice.hostname,
      role: port.connectedDevice.role,
      via: `${port.device.hostname} ${port.name}`,
    });
  }
  for (const subnet of vlan.subnets) {
    for (const address of subnet.addresses) {
      const device = address.interface?.device;
      if (!device || equipment.has(device.id)) continue;
      equipment.set(device.id, { id: device.id, hostname: device.hostname, role: device.role, via: address.address });
    }
  }
  const subnets = vlan.subnets.map((subnet) => {
    const parsed = parsePrefix(subnet.cidr);
    return {
      id: subnet.id,
      name: subnet.name,
      cidr: subnet.cidr,
      gateway: subnet.gatewayAddress
        ? {
            address: subnet.gatewayAddress.address,
            interface: subnet.gatewayAddress.interface
              ? { id: subnet.gatewayAddress.interface.id, name: subnet.gatewayAddress.interface.name, device: subnet.gatewayAddress.interface.device }
              : null,
          }
        : null,
      stats: parsed.ok ? summarize(parsed.prefix, BigInt(subnet.addresses.length)) : null,
      addresses: [...subnet.addresses]
        .sort((left, right) => {
          const a = parseAddress(left.address)?.value ?? 0n;
          const b = parseAddress(right.address)?.value ?? 0n;
          return a < b ? -1 : a > b ? 1 : 0;
        })
        .map((address) => ({
          id: address.id,
          address: address.address,
          role: address.role,
          description: address.description,
          device: address.interface?.device ?? null,
          interfaceName: address.interface?.name ?? null,
        })),
    };
  });
  return {
    ...mapVlan({ ...vlan, subnets: vlan.subnets.map((subnet) => ({ id: subnet.id, cidr: subnet.cidr, gatewayAddress: subnet.gatewayAddress })) }),
    organizationId: vlan.site.organizationId,
    site: vlan.site,
    subnets,
    switches,
    ports: ports.map((port) => ({
      id: port.id,
      name: port.name,
      mode: port.mode,
      status: port.status,
      switch: { id: port.device.id, hostname: port.device.hostname },
      connectedDevice: port.connectedDevice ? { id: port.connectedDevice.id, hostname: port.connectedDevice.hostname, role: port.connectedDevice.role } : null,
    })),
    equipment: [...equipment.values()],
    issues: fabricIssues(
      { vid: vlan.vid, name: vlan.name, siteId: vlan.siteId, status: vlan.status },
      subnets.map((subnet) => ({
        cidr: subnet.cidr,
        gateway: subnet.gateway?.address ?? null,
        gatewayBound: Boolean(subnet.gateway?.interface),
        addresses: subnet.addresses.map((address) => ({ address: address.address, deviceSiteId: address.device?.siteId ?? null })),
      })),
      ports.map((port) => ({
        name: port.name,
        mode: port.mode,
        switchHostname: port.device.hostname,
        switchSiteId: port.device.siteId,
        connectedHostname: port.connectedDevice?.hostname ?? null,
        connectedSiteId: port.connectedDevice?.siteId ?? null,
        connectedAddresses: [
          ...(port.connectedDevice?.managementIp ? [port.connectedDevice.managementIp] : []),
          ...(port.connectedDevice?.interfaces.flatMap((item) => (item.ipAddress ? [item.ipAddress] : [])) ?? []),
        ],
      })),
      siblings,
    ),
  };
}

export async function getVlan(user: AuthUser, vlanId: string) {
  const vlan = await prisma.vlan.findUnique({
    where: { id: vlanId },
    include: {
      site: { select: { id: true, name: true, code: true, organizationId: true } },
      _count: { select: { accessPorts: true, nativePorts: true, trunkPorts: true } },
    },
  });
  if (!vlan) throw new NotFoundError("VLAN introuvable");
  assertPermission(user, vlan.site.organizationId, "inventory:read", "VLAN introuvable");
  return mapVlan(vlan);
}

export async function updateVlan(user: AuthUser, vlanId: string, input: VlanWrite) {
  const current = await prisma.vlan.findUnique({ where: { id: vlanId }, include: { site: { select: { organizationId: true } } } });
  if (!current) throw new NotFoundError("VLAN introuvable");
  assertPermission(user, current.site.organizationId, "inventory:write", "VLAN introuvable");
  if (input.name) await assertVlanName(current.siteId, input.name.trim(), vlanId);
  try {
    const vlan = await prisma.vlan.update({
      where: { id: vlanId },
      data: {
        vid: input.vid,
        name: input.name?.trim(),
        description: input.description !== undefined ? (blankToNull(input.description) ?? null) : undefined,
        role: input.role,
        securityZone: input.securityZone,
        status: input.status,
      },
      include: { site: { select: { id: true, name: true, code: true } }, _count: { select: { accessPorts: true, nativePorts: true, trunkPorts: true } } },
    });
    await recordAudit({
      actor: user,
      organizationId: current.site.organizationId,
      action: "vlan.update",
      resourceType: "Vlan",
      resourceId: vlan.id,
      metadata: { before: { vid: current.vid, name: current.name, status: current.status }, after: { vid: vlan.vid, name: vlan.name, status: vlan.status } },
    });
    return mapVlan(vlan);
  } catch (error) {
    rethrowUnique(error, "Ce VLAN existe déjà");
  }
}

export async function deleteVlan(user: AuthUser, vlanId: string) {
  const current = await prisma.vlan.findUnique({
    where: { id: vlanId },
    include: { site: { select: { organizationId: true } }, _count: { select: { accessPorts: true, nativePorts: true, trunkPorts: true, subnets: true, layer3Interfaces: true, topologyLinks: true } } },
  });
  if (!current) throw new NotFoundError("VLAN introuvable");
  assertPermission(user, current.site.organizationId, "inventory:delete", "VLAN introuvable");
  const usage = current._count.accessPorts + current._count.nativePorts + current._count.trunkPorts;
  if (usage > 0) {
    throw new ConflictError(`Ce VLAN est affecté à ${usage} port(s). Retirez les affectations avant de le supprimer.`);
  }
  if (current._count.subnets > 0) {
    throw new ConflictError("Ce VLAN porte des sous-réseaux. Retirez-les avant de le supprimer.");
  }
  if (current._count.layer3Interfaces > 0) {
    throw new ConflictError("Ce VLAN porte une interface de routage. Retirez-la avant de supprimer le VLAN.");
  }
  const zoneMembership = await prisma.firewallZoneVlan.count({ where: { vlanId: current.id } });
  if (zoneMembership > 0) {
    throw new ConflictError("Ce VLAN appartient à une zone de sécurité. Retirez-le de la zone avant de le supprimer.");
  }
  if (current._count.topologyLinks > 0) {
    throw new ConflictError("Ce VLAN est porté par un lien de topologie. Retirez le lien avant de supprimer le VLAN.");
  }
  await recordAudit({
    actor: user,
    organizationId: current.site.organizationId,
    action: "vlan.delete",
    resourceType: "Vlan",
    resourceId: current.id,
    metadata: { vid: current.vid, name: current.name },
  });
  await prisma.vlan.delete({ where: { id: vlanId } });
  return { ok: true };
}

async function composeSnapshot(
  device: { id: string; role: string; siteId: string; organizationId: string },
  input: PortWrite,
  current?: { accessVlanId: string | null; nativeVlanId: string | null; allowedVlans: { vlanId: string }[]; mode: "ACCESS" | "TRUNK"; name: string; status: string; poe: string; macAddress: string | null; connectedDeviceId: string | null },
) {
  const mode = input.mode ?? current?.mode;
  if (!mode) throw new ValidationError([{ path: "mode", message: "Le mode du port est obligatoire" }]);
  if (mode === "ACCESS" && (input.nativeVlanId || (input.allowedVlanIds && input.allowedVlanIds.length > 0))) {
    throw new ValidationError([{ path: "mode", message: "Un port access porte un seul VLAN, sans VLAN natif ni liste autorisée" }]);
  }
  if (mode === "TRUNK" && input.accessVlanId) {
    throw new ValidationError([{ path: "accessVlanId", message: "Un trunk ne porte pas de VLAN d'accès" }]);
  }
  const accessVlanId = mode === "TRUNK" ? null : input.accessVlanId !== undefined ? input.accessVlanId : current?.accessVlanId ?? null;
  const nativeVlanId = mode === "ACCESS" ? null : input.nativeVlanId !== undefined ? input.nativeVlanId : current?.nativeVlanId ?? null;
  const allowedVlanIds = mode === "ACCESS" ? [] : input.allowedVlanIds ?? current?.allowedVlans.map((link) => link.vlanId) ?? [];
  if (allowedVlanIds.length !== new Set(allowedVlanIds).size) {
    throw new ValidationError([{ path: "allowedVlanIds", message: "La liste des VLAN contient un doublon" }]);
  }
  const ids = [accessVlanId, nativeVlanId, ...allowedVlanIds].filter((id): id is string => Boolean(id));
  const vlans = await vlansOnSite(device.siteId, ids);
  const byId = new Map(vlans.map((vlan) => [vlan.id, vlan]));
  const connectedDeviceId = input.connectedDeviceId !== undefined ? input.connectedDeviceId : current?.connectedDeviceId ?? null;
  return {
    id: "draft",
    name: input.name ?? current?.name ?? "port",
    mode,
    status: input.status ?? current?.status ?? "DOWN",
    poe: input.poe ?? current?.poe ?? "OFF",
    macAddress: input.macAddress !== undefined ? input.macAddress : current?.macAddress ?? null,
    deviceId: device.id,
    deviceRole: device.role,
    deviceSiteId: device.siteId,
    deviceOrganizationId: device.organizationId,
    accessVlan: accessVlanId ? toVlanRef(byId.get(accessVlanId) ?? null) : null,
    nativeVlan: nativeVlanId ? toVlanRef(byId.get(nativeVlanId) ?? null) : null,
    allowedVlans: allowedVlanIds.map((id) => toVlanRef(byId.get(id) ?? null)!).filter(Boolean),
    connectedDeviceId,
    connectedOrganizationId: connectedDeviceId ? device.organizationId : null,
  } satisfies PortSnapshot;
}

export async function listPorts(user: AuthUser, deviceId: string) {
  const device = await loadSwitch(user, deviceId, "inventory:read");
  const ports = await prisma.switchPort.findMany({
    where: { deviceId: device.id },
    include: portInclude,
    orderBy: { name: "asc" },
  });
  return { data: ports.map(mapPort) };
}

export async function switchingView(user: AuthUser, deviceId: string) {
  const device = await loadSwitch(user, deviceId, "inventory:read");
  const [ports, vlans] = await Promise.all([
    prisma.switchPort.findMany({ where: { deviceId: device.id }, include: portInclude, orderBy: { name: "asc" } }),
    prisma.vlan.findMany({
      where: { siteId: device.siteId },
      include: { _count: { select: { accessPorts: true, nativePorts: true, trunkPorts: true } } },
      orderBy: { vid: "asc" },
    }),
  ]);
  const snapshots = ports.map(snapshot);
  const inconsistencies = issuesForSwitch(snapshots);
  const macs = [...new Set(snapshots.flatMap((port) => (port.macAddress ? [port.macAddress] : [])))];
  if (macs.length > 0) {
    const interfaces = await prisma.networkInterface.findMany({
      where: { macAddress: { in: macs }, device: { organizationId: device.organizationId } },
      select: { macAddress: true, name: true, device: { select: { hostname: true } } },
    });
    for (const networkInterface of interfaces) {
      const port = snapshots.find((item) => item.macAddress === networkInterface.macAddress);
      inconsistencies.push({
        code: "DUPLICATE_MAC",
        message: `L'adresse MAC ${networkInterface.macAddress} du port ${port?.name ?? "inconnu"} est déjà portée par ${networkInterface.name} sur ${networkInterface.device.hostname}`,
        portId: port?.id,
      });
    }
  }
  return {
    device: { id: device.id, hostname: device.hostname, site: device.site },
    tree: renderSwitchTree(device.hostname, snapshots),
    ports: ports.map(mapPort),
    vlans: vlans.map(mapVlan),
    inconsistencies,
  };
}

export async function createPort(user: AuthUser, deviceId: string, input: PortWrite) {
  const device = await loadSwitch(user, deviceId, "inventory:write");
  const draft = await composeSnapshot(device, input);
  assertWritable(draft);
  await assertConnectedDevice(device.organizationId, device.id, draft.connectedDeviceId);
  await assertMacAvailable(device.organizationId, draft.macAddress);
  try {
    const port = await prisma.$transaction(async (tx) => {
      const created = await tx.switchPort.create({
        data: {
          deviceId: device.id,
          name: input.name!,
          status: draft.status as "UP" | "DOWN" | "ADMIN_DOWN" | "ERR_DISABLED",
          mode: draft.mode,
          accessVlanId: draft.accessVlan?.id ?? null,
          nativeVlanId: draft.nativeVlan?.id ?? null,
          speedMbps: input.speedMbps ?? null,
          duplex: input.duplex ?? null,
          description: blankToNull(input.description) ?? null,
          connectedDeviceId: draft.connectedDeviceId,
          macAddress: draft.macAddress,
          poe: draft.poe as "OFF" | "ON" | "FAULT",
        },
      });
      if (draft.allowedVlans.length > 0) {
        await tx.switchPortVlan.createMany({
          data: draft.allowedVlans.map((vlan) => ({ portId: created.id, vlanId: vlan.id })),
        });
      }
      return tx.switchPort.findUniqueOrThrow({ where: { id: created.id }, include: portInclude });
    });
    await recordAudit({
      actor: user,
      organizationId: device.organizationId,
      action: "switch-port.create",
      resourceType: "SwitchPort",
      resourceId: port.id,
      metadata: { switch: device.hostname, name: port.name, mode: port.mode },
    });
    return mapPort(port);
  } catch (error) {
    rethrowUnique(error, "Ce port existe déjà");
  }
}

export async function updatePort(user: AuthUser, portId: string, input: PortWrite) {
  const current = await prisma.switchPort.findUnique({ where: { id: portId }, include: portInclude });
  if (!current) throw new NotFoundError("Port introuvable");
  assertPermission(user, current.device.organizationId, "inventory:write", "Port introuvable");
  if (current.device.role !== "SWITCH") throw new ConflictError("Cet équipement n'est pas un commutateur");
  const draft = await composeSnapshot(current.device, { ...input, name: input.name ?? current.name }, current);
  assertWritable(draft);
  await assertConnectedDevice(current.device.organizationId, current.device.id, draft.connectedDeviceId);
  await assertMacAvailable(current.device.organizationId, draft.macAddress, portId);
  try {
    const port = await prisma.$transaction(async (tx) => {
      await tx.switchPort.update({
        where: { id: portId },
        data: {
          name: input.name,
          status: draft.status as "UP" | "DOWN" | "ADMIN_DOWN" | "ERR_DISABLED",
          mode: draft.mode,
          accessVlanId: draft.accessVlan?.id ?? null,
          nativeVlanId: draft.nativeVlan?.id ?? null,
          speedMbps: input.speedMbps !== undefined ? input.speedMbps : undefined,
          duplex: input.duplex !== undefined ? input.duplex : undefined,
          description: input.description !== undefined ? (blankToNull(input.description) ?? null) : undefined,
          connectedDeviceId: input.connectedDeviceId !== undefined ? draft.connectedDeviceId : undefined,
          macAddress: input.macAddress !== undefined ? draft.macAddress : undefined,
          poe: input.poe,
        },
      });
      if (input.allowedVlanIds || input.mode) {
        await tx.switchPortVlan.deleteMany({ where: { portId } });
        if (draft.allowedVlans.length > 0) {
          await tx.switchPortVlan.createMany({
            data: draft.allowedVlans.map((vlan) => ({ portId, vlanId: vlan.id })),
          });
        }
      }
      return tx.switchPort.findUniqueOrThrow({ where: { id: portId }, include: portInclude });
    });
    await recordAudit({
      actor: user,
      organizationId: current.device.organizationId,
      action: "switch-port.update",
      resourceType: "SwitchPort",
      resourceId: port.id,
      metadata: {
        switch: current.device.hostname,
        before: { name: current.name, mode: current.mode },
        after: { name: port.name, mode: port.mode },
      },
    });
    return mapPort(port);
  } catch (error) {
    rethrowUnique(error, "Ce port existe déjà");
  }
}

export async function deletePort(user: AuthUser, portId: string) {
  const current = await prisma.switchPort.findUnique({
    where: { id: portId },
    include: { device: { select: { hostname: true, organizationId: true } } },
  });
  if (!current) throw new NotFoundError("Port introuvable");
  assertPermission(user, current.device.organizationId, "inventory:delete", "Port introuvable");
  await recordAudit({
    actor: user,
    organizationId: current.device.organizationId,
    action: "switch-port.delete",
    resourceType: "SwitchPort",
    resourceId: current.id,
    metadata: { switch: current.device.hostname, name: current.name, mode: current.mode },
  });
  await prisma.switchPort.delete({ where: { id: portId } });
  return { ok: true };
}
