import { Prisma } from "../../../generated/prisma/client";
import { recordAudit } from "../audit";
import type { AuthUser } from "../auth/context";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import {
  containsAddress,
  formatAddress,
  isUsable,
  nextUsable,
  parseAddress,
  parsePrefix,
  placement,
  rangeContains,
  rangesOverlap,
  summarize,
  utilizationGrid,
  type ParsedPrefix,
} from "../ipam/address";
import { planVlsm, type VlsmRequest } from "../ipam/vlsm";
import { prisma } from "../prisma";
import { assertPermission } from "../rbac/guard";
import { blankToNull } from "../validation/network";

type AddressRole = "GATEWAY" | "ALLOCATED" | "RESERVED";

const addressInclude = {
  interface: { select: { id: true, name: true, device: { select: { id: true, hostname: true, siteId: true } } } },
} as const;

function requirePrefix(cidr: string, path = "cidr") {
  const parsed = parsePrefix(cidr);
  if (!parsed.ok) {
    throw new ValidationError([
      {
        path,
        message: parsed.reason === "HOST_BITS" ? "Le préfixe doit être l'adresse réseau" : "Préfixe CIDR invalide",
      },
    ]);
  }
  return parsed.prefix;
}

function requireAddress(value: string, path = "address") {
  const parsed = parseAddress(value);
  if (!parsed) throw new ValidationError([{ path, message: "Adresse IP invalide" }]);
  return parsed;
}

function rethrowUnique(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    const target = Array.isArray(error.meta?.target) ? error.meta.target.join(" ") : String(error.meta?.target ?? "");
    if (target.includes("address")) throw new ConflictError("Cette adresse IP est déjà attribuée");
    if (target.includes("cidr")) throw new ConflictError("Ce préfixe existe déjà");
    if (target.includes("name")) throw new ConflictError("Ce nom existe déjà");
    if (target.includes("interface")) throw new ConflictError("Cette interface porte déjà une adresse IPAM");
    throw new ConflictError("Cet élément existe déjà");
  }
  throw error;
}

async function requireOrganization(user: AuthUser, organizationId: string, permission: "inventory:read" | "inventory:write" | "inventory:delete") {
  const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true } });
  if (!organization) throw new NotFoundError("Organisation introuvable");
  assertPermission(user, organizationId, permission, "Organisation introuvable");
}

function assertInside(parent: ParsedPrefix, child: ParsedPrefix) {
  if (parent.family !== child.family || !rangeContains(parent, child)) {
    throw new ValidationError([{ path: "cidr", message: "Le sous-réseau doit être inclus dans son réseau" }]);
  }
}

function assertNoOverlap(candidate: ParsedPrefix, existing: { id?: string; cidr: string; name: string }[], allowedId?: string) {
  for (const item of existing) {
    if (allowedId && item.id === allowedId) continue;
    const other = parsePrefix(item.cidr);
    if (!other.ok || other.prefix.family !== candidate.family) continue;
    if (rangesOverlap(candidate, other.prefix)) {
      throw new ConflictError(`Ce préfixe chevauche ${item.name} (${other.prefix.cidr})`);
    }
  }
}

async function prefixesOf(organizationId: string) {
  const [networks, subnets] = await Promise.all([
    prisma.ipNetwork.findMany({ where: { organizationId }, select: { id: true, cidr: true, name: true } }),
    prisma.ipSubnet.findMany({ where: { network: { organizationId } }, select: { id: true, cidr: true, name: true, networkId: true } }),
  ]);
  return { networks, subnets };
}

async function singleHolder(organizationId: string, address: string) {
  const interfaces = await prisma.networkInterface.findMany({
    where: { ipAddress: address, device: { organizationId } },
    select: { id: true, name: true, deviceId: true, device: { select: { hostname: true } } },
  });
  const managers = await prisma.device.findMany({
    where: { organizationId, managementIp: address },
    select: { id: true, hostname: true },
  });
  if (interfaces.length > 1) {
    throw new ConflictError(`L'adresse ${address} est déjà portée par plusieurs interfaces`);
  }
  const holder = interfaces[0];
  const foreign = managers.find((device) => device.id !== holder?.deviceId);
  if (foreign) throw new ConflictError(`L'adresse ${address} est déjà l'IP de management de ${foreign.hostname}`);
  if (!holder && managers.length > 0) {
    throw new ConflictError(`L'adresse ${address} est déjà l'IP de management de ${managers[0]?.hostname}`);
  }
  return holder?.id ?? null;
}

async function assertName(siteId: string, name: string, exceptNetworkId?: string) {
  const existing = await prisma.ipNetwork.findFirst({
    where: { siteId, name: { equals: name, mode: "insensitive" }, ...(exceptNetworkId ? { id: { not: exceptNetworkId } } : {}) },
    select: { id: true },
  });
  if (existing) throw new ConflictError("Ce nom de réseau existe déjà sur ce site");
}

function statsFor(cidr: string, used: number) {
  return summarize(requirePrefix(cidr), BigInt(used));
}

function mapAddress(address: {
  id: string;
  address: string;
  role: AddressRole;
  description: string | null;
  interface: { id: string; name: string; device: { id: string; hostname: string } } | null;
}) {
  return {
    id: address.id,
    address: address.address,
    role: address.role,
    description: address.description,
    interface: address.interface,
  };
}

export async function ipamOverview(user: AuthUser, organizationId: string, query: { siteId?: string }) {
  await requireOrganization(user, organizationId, "inventory:read");
  if (query.siteId) {
    const site = await prisma.site.findFirst({ where: { id: query.siteId, organizationId }, select: { id: true } });
    if (!site) throw new NotFoundError("Site introuvable");
  }
  const networks = await prisma.ipNetwork.findMany({
    where: { organizationId, siteId: query.siteId },
    include: {
      site: { select: { id: true, name: true, code: true } },
      subnets: {
        include: {
          vlan: { select: { id: true, vid: true, name: true } },
          _count: { select: { addresses: true } },
        },
        orderBy: { cidr: "asc" },
      },
    },
    orderBy: { cidr: "asc" },
  });
  const orphans = await prisma.networkInterface.findMany({
    where: {
      ipAddress: { not: null },
      device: { organizationId, siteId: query.siteId },
      ipAllocation: null,
    },
    select: { id: true, name: true, ipAddress: true, device: { select: { id: true, hostname: true } } },
    orderBy: { ipAddress: "asc" },
  });
  return {
    networks: networks.map((network) => ({
      id: network.id,
      name: network.name,
      description: network.description,
      cidr: network.cidr,
      family: network.family,
      site: network.site,
      stats: statsFor(network.cidr, network.subnets.reduce((total, subnet) => total + subnet._count.addresses, 0)),
      subnets: network.subnets.map((subnet) => ({
        id: subnet.id,
        name: subnet.name,
        description: subnet.description,
        cidr: subnet.cidr,
        family: subnet.family,
        vlan: subnet.vlan,
        stats: statsFor(subnet.cidr, subnet._count.addresses),
      })),
    })),
    orphans: orphans.map((item) => ({
      address: item.ipAddress,
      interface: { id: item.id, name: item.name, device: item.device },
      code: "ORPHAN_INTERFACE",
      message: `${item.ipAddress} sur ${item.device.hostname} ${item.name} n'est pas allouée`,
    })),
  };
}

export async function createNetwork(
  user: AuthUser,
  organizationId: string,
  input: { siteId: string; name: string; description?: string | null; cidr: string },
) {
  await requireOrganization(user, organizationId, "inventory:write");
  const site = await prisma.site.findFirst({ where: { id: input.siteId, organizationId }, select: { id: true } });
  if (!site) throw new NotFoundError("Site introuvable");
  const prefix = requirePrefix(input.cidr);
  await assertName(site.id, input.name.trim());
  const existing = await prefixesOf(organizationId);
  assertNoOverlap(prefix, [...existing.networks, ...existing.subnets]);
  try {
    const network = await prisma.ipNetwork.create({
      data: {
        organizationId,
        siteId: site.id,
        name: input.name.trim(),
        description: blankToNull(input.description) ?? null,
        cidr: prefix.cidr,
        family: prefix.family,
        prefixLength: prefix.prefix,
      },
      include: { site: { select: { id: true, name: true, code: true } } },
    });
    await recordAudit({
      actor: user,
      organizationId,
      action: "ip-network.create",
      resourceType: "IpNetwork",
      resourceId: network.id,
      metadata: { name: network.name, cidr: network.cidr },
    });
    return network;
  } catch (error) {
    rethrowUnique(error);
  }
}

export async function updateNetwork(user: AuthUser, networkId: string, input: { name?: string; description?: string | null }) {
  const current = await prisma.ipNetwork.findUnique({ where: { id: networkId } });
  if (!current) throw new NotFoundError("Réseau introuvable");
  assertPermission(user, current.organizationId, "inventory:write", "Réseau introuvable");
  if (input.name) await assertName(current.siteId, input.name.trim(), networkId);
  const network = await prisma.ipNetwork.update({
    where: { id: networkId },
    data: {
      name: input.name?.trim(),
      description: input.description !== undefined ? (blankToNull(input.description) ?? null) : undefined,
    },
  });
  await recordAudit({
    actor: user,
    organizationId: current.organizationId,
    action: "ip-network.update",
    resourceType: "IpNetwork",
    resourceId: network.id,
    metadata: { before: { name: current.name }, after: { name: network.name } },
  });
  return network;
}

export async function deleteNetwork(user: AuthUser, networkId: string) {
  const current = await prisma.ipNetwork.findUnique({ where: { id: networkId }, include: { _count: { select: { subnets: true } } } });
  if (!current) throw new NotFoundError("Réseau introuvable");
  assertPermission(user, current.organizationId, "inventory:delete", "Réseau introuvable");
  if (current._count.subnets > 0) throw new ConflictError("Ce réseau contient des sous-réseaux. Retirez-les avant de le supprimer.");
  await recordAudit({
    actor: user,
    organizationId: current.organizationId,
    action: "ip-network.delete",
    resourceType: "IpNetwork",
    resourceId: current.id,
    metadata: { name: current.name, cidr: current.cidr },
  });
  await prisma.ipNetwork.delete({ where: { id: networkId } });
  return { ok: true };
}

export async function createSubnet(
  user: AuthUser,
  organizationId: string,
  input: { networkId: string; vlanId: string; name: string; description?: string | null; cidr: string; gateway: string },
) {
  await requireOrganization(user, organizationId, "inventory:write");
  const network = await prisma.ipNetwork.findFirst({ where: { id: input.networkId, organizationId } });
  if (!network) throw new NotFoundError("Réseau introuvable");
  const vlan = await prisma.vlan.findUnique({ where: { id: input.vlanId }, include: { site: { select: { organizationId: true } } } });
  if (!vlan || vlan.site.organizationId !== organizationId) throw new NotFoundError("VLAN introuvable");
  if (vlan.siteId !== network.siteId) {
    throw new ValidationError([{ path: "vlanId", message: "Le VLAN doit appartenir au site du réseau" }]);
  }
  const prefix = requirePrefix(input.cidr);
  const parent = requirePrefix(network.cidr);
  assertInside(parent, prefix);
  const gateway = requireAddress(input.gateway, "gateway");
  if (!isUsable(prefix, gateway)) {
    throw new ValidationError([{ path: "gateway", message: "La passerelle est hors du sous-réseau ou n'est pas utilisable" }]);
  }
  const existing = await prefixesOf(organizationId);
  assertNoOverlap(prefix, [...existing.networks, ...existing.subnets], network.id);
  const holderId = await singleHolder(organizationId, gateway.text);
  try {
    const subnet = await prisma.$transaction(async (tx) => {
      const created = await tx.ipSubnet.create({
        data: {
          networkId: network.id,
          vlanId: vlan.id,
          name: input.name.trim(),
          description: blankToNull(input.description) ?? null,
          cidr: prefix.cidr,
          family: prefix.family,
          prefixLength: prefix.prefix,
        },
      });
      const address = await tx.ipAddress.create({
        data: {
          organizationId,
          subnetId: created.id,
          address: gateway.text,
          role: "GATEWAY",
          interfaceId: holderId,
        },
      });
      return tx.ipSubnet.update({
        where: { id: created.id },
        data: { gatewayAddressId: address.id },
        include: { vlan: { select: { id: true, vid: true, name: true } }, gatewayAddress: true },
      });
    });
    await recordAudit({
      actor: user,
      organizationId,
      action: "ip-subnet.create",
      resourceType: "IpSubnet",
      resourceId: subnet.id,
      metadata: { name: subnet.name, cidr: subnet.cidr, gateway: gateway.text, vlanId: vlan.id },
    });
    return { ...subnet, stats: statsFor(subnet.cidr, 1) };
  } catch (error) {
    rethrowUnique(error);
  }
}

async function loadSubnet(subnetId: string) {
  const subnet = await prisma.ipSubnet.findUnique({
    where: { id: subnetId },
    include: {
      network: { include: { site: { select: { id: true, name: true, code: true, organizationId: true } } } },
      vlan: { select: { id: true, vid: true, name: true, siteId: true } },
      gatewayAddress: { include: addressInclude },
      addresses: { include: addressInclude, orderBy: { address: "asc" } },
    },
  });
  if (!subnet) throw new NotFoundError("Sous-réseau introuvable");
  return subnet;
}

function subnetIssues(
  subnet: { id: string; cidr: string; gatewayAddress: { address: string } | null; addresses: { address: string }[] },
  others: { id: string; cidr: string; name: string }[],
  parentNetworkId: string,
) {
  const prefix = requirePrefix(subnet.cidr);
  const issues: { code: string; message: string }[] = [];
  if (!subnet.gatewayAddress) issues.push({ code: "GATEWAY_MISSING", message: "Le sous-réseau n'a pas de passerelle" });
  else {
    const gateway = parseAddress(subnet.gatewayAddress.address);
    if (!gateway || !isUsable(prefix, gateway)) {
      issues.push({ code: "GATEWAY_OUTSIDE", message: `La passerelle ${subnet.gatewayAddress.address} est hors du sous-réseau` });
    }
  }
  const seen = new Set<string>();
  for (const address of subnet.addresses) {
    if (seen.has(address.address)) issues.push({ code: "DUPLICATE_IP", message: `L'adresse ${address.address} est dupliquée` });
    seen.add(address.address);
    const parsed = parseAddress(address.address);
    if (!parsed || placement(prefix, parsed) !== "OK") {
      issues.push({ code: "ADDRESS_OUTSIDE", message: `L'adresse ${address.address} est hors du sous-réseau` });
    }
  }
  for (const other of others) {
    if (other.id === parentNetworkId || other.id === subnet.id) continue;
    const parsed = parsePrefix(other.cidr);
    if (parsed.ok && parsed.prefix.family === prefix.family && rangesOverlap(prefix, parsed.prefix)) {
      issues.push({ code: "OVERLAP", message: `Chevauchement avec ${other.name} (${parsed.prefix.cidr})` });
    }
  }
  if (BigInt(subnet.addresses.length) > prefix.usable) {
    issues.push({ code: "ALLOCATION_IMPOSSIBLE", message: "Il y a plus d'adresses attribuées que d'adresses utilisables" });
  }
  return issues;
}

export async function getSubnet(user: AuthUser, subnetId: string) {
  const subnet = await loadSubnet(subnetId);
  assertPermission(user, subnet.network.site.organizationId, "inventory:read", "Sous-réseau introuvable");
  const prefix = requirePrefix(subnet.cidr);
  const existing = await prefixesOf(subnet.network.site.organizationId);
  const marks = new Map<string, "gateway" | "allocated" | "reserved">();
  for (const address of subnet.addresses) {
    marks.set(address.address, address.role === "GATEWAY" ? "gateway" : address.role === "RESERVED" ? "reserved" : "allocated");
  }
  const addresses = [...subnet.addresses].sort((left, right) => {
    const a = parseAddress(left.address)?.value ?? 0n;
    const b = parseAddress(right.address)?.value ?? 0n;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  return {
    id: subnet.id,
    name: subnet.name,
    description: subnet.description,
    cidr: subnet.cidr,
    family: subnet.family,
    network: { id: subnet.network.id, name: subnet.network.name, cidr: subnet.network.cidr },
    site: { id: subnet.network.site.id, name: subnet.network.site.name, code: subnet.network.site.code },
    organizationId: subnet.network.site.organizationId,
    vlan: subnet.vlan,
    gateway: subnet.gatewayAddress ? mapAddress(subnet.gatewayAddress) : null,
    stats: statsFor(subnet.cidr, subnet.addresses.length),
    grid: utilizationGrid(prefix, marks),
    addresses: addresses.map(mapAddress),
    issues: subnetIssues(subnet, [...existing.networks, ...existing.subnets], subnet.network.id),
  };
}

export async function updateSubnet(user: AuthUser, subnetId: string, input: { name?: string; description?: string | null; gateway?: string }) {
  const current = await loadSubnet(subnetId);
  const organizationId = current.network.site.organizationId;
  assertPermission(user, organizationId, "inventory:write", "Sous-réseau introuvable");
  if (input.gateway) {
    const prefix = requirePrefix(current.cidr);
    const gateway = requireAddress(input.gateway, "gateway");
    if (current.gatewayAddress?.address !== gateway.text) {
      if (!isUsable(prefix, gateway)) {
        throw new ValidationError([{ path: "gateway", message: "La passerelle est hors du sous-réseau ou n'est pas utilisable" }]);
      }
      if (current.gatewayAddress?.interfaceId) {
        throw new ConflictError("La passerelle actuelle est liée à une interface. Retirez cette liaison avant de la changer.");
      }
      const taken = current.addresses.find((address) => address.address === gateway.text);
      if (taken) throw new ConflictError(`L'adresse ${gateway.text} est déjà attribuée dans ce sous-réseau`);
      const holderId = await singleHolder(organizationId, gateway.text);
      await prisma.$transaction(async (tx) => {
        await tx.ipSubnet.update({ where: { id: current.id }, data: { gatewayAddressId: null } });
        if (current.gatewayAddress) await tx.ipAddress.delete({ where: { id: current.gatewayAddress.id } });
        const created = await tx.ipAddress.create({
          data: { organizationId, subnetId: current.id, address: gateway.text, role: "GATEWAY", interfaceId: holderId },
        });
        await tx.ipSubnet.update({ where: { id: current.id }, data: { gatewayAddressId: created.id } });
      });
    }
  }
  const subnet = await prisma.ipSubnet.update({
    where: { id: subnetId },
    data: {
      name: input.name?.trim(),
      description: input.description !== undefined ? (blankToNull(input.description) ?? null) : undefined,
    },
  });
  await recordAudit({
    actor: user,
    organizationId,
    action: "ip-subnet.update",
    resourceType: "IpSubnet",
    resourceId: subnet.id,
    metadata: { name: subnet.name, gateway: input.gateway },
  });
  return getSubnet(user, subnetId);
}

export async function deleteSubnet(user: AuthUser, subnetId: string) {
  const current = await loadSubnet(subnetId);
  const organizationId = current.network.site.organizationId;
  assertPermission(user, organizationId, "inventory:delete", "Sous-réseau introuvable");
  const blocking = current.addresses.filter((address) => address.role !== "GATEWAY" || address.interfaceId);
  if (blocking.length > 0) {
    throw new ConflictError("Ce sous-réseau a des adresses attribuées. Retirez les allocations et les réservations avant de le supprimer.");
  }
  const [dhcpScopes, dhcpRelays, dnsZones, layer3Interfaces] = await Promise.all([
    prisma.dhcpScope.count({ where: { subnetId: current.id } }),
    prisma.dhcpRelay.count({ where: { subnetId: current.id } }),
    prisma.dnsZone.count({ where: { subnetId: current.id } }),
    prisma.layer3Interface.count({ where: { subnetId: current.id } }),
  ]);
  if (dhcpScopes > 0) throw new ConflictError("Ce sous-réseau porte un scope DHCP. Retirez-le avant de supprimer le sous-réseau.");
  if (dhcpRelays > 0) throw new ConflictError("Ce sous-réseau porte un relais DHCP. Retirez-le avant de supprimer le sous-réseau.");
  if (dnsZones > 0) throw new ConflictError("Ce sous-réseau porte une zone DNS inverse. Retirez-la avant de supprimer le sous-réseau.");
  if (layer3Interfaces > 0) throw new ConflictError("Ce sous-réseau est connecté à un routeur. Retirez l'interface de routage avant de le supprimer.");
  await recordAudit({
    actor: user,
    organizationId,
    action: "ip-subnet.delete",
    resourceType: "IpSubnet",
    resourceId: current.id,
    metadata: { name: current.name, cidr: current.cidr },
  });
  await prisma.$transaction(async (tx) => {
    await tx.ipSubnet.update({ where: { id: current.id }, data: { gatewayAddressId: null } });
    await tx.ipAddress.deleteMany({ where: { subnetId: current.id } });
    await tx.ipSubnet.delete({ where: { id: current.id } });
  });
  return { ok: true };
}

export async function createAddress(
  user: AuthUser,
  subnetId: string,
  input: { role: "ALLOCATED" | "RESERVED"; address?: string; interfaceId?: string; description?: string },
) {
  const subnet = await loadSubnet(subnetId);
  const organizationId = subnet.network.site.organizationId;
  assertPermission(user, organizationId, "inventory:write", "Sous-réseau introuvable");
  const prefix = requirePrefix(subnet.cidr);
  let chosen = input.address ? requireAddress(input.address) : null;
  if (!chosen) {
    const used = subnet.addresses.flatMap((address) => {
      const parsed = parseAddress(address.address);
      return parsed ? [parsed.value] : [];
    });
    const next = nextUsable(prefix, used);
    if (next === null) throw new ConflictError("Allocation impossible : plus aucune adresse utilisable");
    chosen = requireAddress(formatAddress(prefix.family, next));
  }
  if (!containsAddress(prefix, chosen)) {
    throw new ValidationError([{ path: "address", message: "L'adresse est hors du sous-réseau" }]);
  }
  if (!isUsable(prefix, chosen)) {
    throw new ValidationError([{ path: "address", message: "L'adresse réseau ou de broadcast ne peut pas être attribuée" }]);
  }
  if (subnet.addresses.some((address) => address.address === chosen.text)) {
    throw new ConflictError(`L'adresse ${chosen.text} est déjà attribuée`);
  }
  const selected = chosen;
  let interfaceId: string | null = null;
  if (input.role === "ALLOCATED" && input.interfaceId) {
    const networkInterface = await prisma.networkInterface.findUnique({
      where: { id: input.interfaceId },
      include: { device: { select: { id: true, hostname: true, organizationId: true, siteId: true } }, ipAllocation: { select: { id: true, address: true } } },
    });
    if (!networkInterface || networkInterface.device.organizationId !== organizationId) throw new NotFoundError("Interface introuvable");
    if (networkInterface.device.siteId !== subnet.network.siteId) {
      throw new ConflictError("L'équipement n'est pas sur le site du sous-réseau");
    }
    if (networkInterface.ipAllocation) throw new ConflictError(`Cette interface porte déjà ${networkInterface.ipAllocation.address}`);
    if (networkInterface.ipAddress && networkInterface.ipAddress !== selected.text) {
      throw new ConflictError(`L'interface porte déjà ${networkInterface.ipAddress}`);
    }
    const holderId = await singleHolder(organizationId, selected.text);
    if (holderId && holderId !== networkInterface.id) throw new ConflictError(`L'adresse ${selected.text} est déjà portée par une autre interface`);
    interfaceId = networkInterface.id;
  }
  if (input.role === "RESERVED") await singleHolder(organizationId, selected.text);
  try {
    const address = await prisma.$transaction(async (tx) => {
      const created = await tx.ipAddress.create({
        data: {
          organizationId,
          subnetId: subnet.id,
          address: selected.text,
          role: input.role,
          interfaceId,
          description: blankToNull(input.description) ?? null,
        },
        include: addressInclude,
      });
      if (interfaceId) await tx.networkInterface.update({ where: { id: interfaceId }, data: { ipAddress: selected.text } });
      return created;
    });
    await recordAudit({
      actor: user,
      organizationId,
      action: input.role === "RESERVED" ? "ip-address.reserve" : "ip-address.allocate",
      resourceType: "IpAddress",
      resourceId: address.id,
      metadata: { address: address.address, subnet: subnet.cidr, interfaceId },
    });
    return mapAddress(address);
  } catch (error) {
    rethrowUnique(error);
  }
}

export async function deleteAddress(user: AuthUser, addressId: string) {
  const current = await prisma.ipAddress.findUnique({
    where: { id: addressId },
    include: { subnet: { include: { network: { select: { organizationId: true, cidr: true } } } }, gatewayFor: { select: { id: true } }, interface: true },
  });
  if (!current) throw new NotFoundError("Adresse introuvable");
  assertPermission(user, current.subnet.network.organizationId, "inventory:delete", "Adresse introuvable");
  if (current.gatewayFor) throw new ConflictError("Cette adresse est la passerelle du sous-réseau. Changez la passerelle avant de la retirer.");
  await recordAudit({
    actor: user,
    organizationId: current.subnet.network.organizationId,
    action: "ip-address.delete",
    resourceType: "IpAddress",
    resourceId: current.id,
    metadata: { address: current.address, role: current.role },
  });
  await prisma.$transaction(async (tx) => {
    if (current.interface && current.interface.ipAddress === current.address) {
      await tx.networkInterface.update({ where: { id: current.interface.id }, data: { ipAddress: null } });
    }
    await tx.ipAddress.delete({ where: { id: current.id } });
  });
  return { ok: true };
}

export async function attachSubnetToVlan(
  user: AuthUser,
  organizationId: string,
  vlan: { id: string; siteId: string; name: string },
  input: { cidr: string; gateway: string },
) {
  const prefix = requirePrefix(input.cidr);
  const gateway = requireAddress(input.gateway, "gateway");
  if (!isUsable(prefix, gateway)) {
    throw new ValidationError([{ path: "gateway", message: "La passerelle est hors du sous-réseau ou n'est pas utilisable" }]);
  }
  const existing = await prefixesOf(organizationId);
  const containers = existing.networks.flatMap((network) => {
    const parsed = parsePrefix(network.cidr);
    if (!parsed.ok || parsed.prefix.family !== prefix.family || !rangeContains(parsed.prefix, prefix)) return [];
    return [{ id: network.id, siteId: "", prefixLength: parsed.prefix.prefix, cidr: parsed.prefix.cidr }];
  });
  const networks = await prisma.ipNetwork.findMany({
    where: { id: { in: containers.map((item) => item.id) }, siteId: vlan.siteId },
    select: { id: true, prefixLength: true },
  });
  const container = networks.sort((left, right) => right.prefixLength - left.prefixLength)[0];
  let createdNetworkId: string | null = null;
  let networkId = container?.id;
  if (!networkId) {
    assertNoOverlap(prefix, [...existing.networks, ...existing.subnets]);
    const nameTaken = await prisma.ipNetwork.findFirst({
      where: { siteId: vlan.siteId, name: { equals: vlan.name, mode: "insensitive" } },
      select: { id: true },
    });
    const network = await createNetwork(user, organizationId, {
      siteId: vlan.siteId,
      name: nameTaken ? `${vlan.name} ${prefix.cidr}` : vlan.name,
      description: `Réseau du VLAN ${vlan.name}`,
      cidr: prefix.cidr,
    });
    createdNetworkId = network.id;
    networkId = network.id;
  }
  const subnetNameTaken = await prisma.ipSubnet.findFirst({
    where: { networkId, name: { equals: vlan.name, mode: "insensitive" } },
    select: { id: true },
  });
  try {
    return await createSubnet(user, organizationId, {
      networkId,
      vlanId: vlan.id,
      name: subnetNameTaken ? `${vlan.name} ${prefix.cidr}` : vlan.name,
      description: `Sous-réseau du VLAN ${vlan.name}`,
      cidr: prefix.cidr,
      gateway: gateway.text,
    });
  } catch (error) {
    if (createdNetworkId) {
      const count = await prisma.ipSubnet.count({ where: { networkId: createdNetworkId } });
      if (count === 0) await prisma.ipNetwork.delete({ where: { id: createdNetworkId } }).catch(() => undefined);
    }
    throw error;
  }
}

export function calculateVlsm(input: { cidr: string; requests: VlsmRequest[] }) {
  const plan = planVlsm(input.cidr, input.requests);
  if (!plan.family && plan.message) throw new ValidationError([{ path: "cidr", message: plan.message }]);
  return plan;
}
