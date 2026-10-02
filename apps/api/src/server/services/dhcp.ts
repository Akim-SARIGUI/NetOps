import { Prisma } from "../../../generated/prisma/client";
import { recordAudit } from "../audit";
import type { AuthUser } from "../auth/context";
import {
  describeScope,
  exclusionIssue,
  gatewayIssue,
  isLeaseActive,
  manualLeaseIssue,
  poolIssue,
  reservationIssue,
  selectLeaseAddress,
} from "../dhcp/evaluate";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import { parseAddress, parsePrefix } from "../ipam/address";
import { prisma } from "../prisma";
import { assertPermission } from "../rbac/guard";
import { blankToNull, isHostname, normalizeHostname, normalizeMac } from "../validation/network";

const DEFAULT_LEASE_SECONDS = 28_800;

const scopeInclude = {
  server: {
    select: {
      id: true,
      name: true,
      address: true,
      status: true,
      siteId: true,
      organizationId: true,
      device: { select: { id: true, hostname: true } },
    },
  },
  subnet: {
    select: {
      id: true,
      name: true,
      cidr: true,
      gatewayAddress: { select: { address: true } },
      vlan: { select: { id: true, vid: true, name: true } },
      network: { select: { site: { select: { id: true, name: true, code: true, organizationId: true } } } },
    },
  },
  pools: { orderBy: { startAddress: "asc" as const } },
  exclusions: { orderBy: { startAddress: "asc" as const } },
  reservations: { orderBy: { address: "asc" as const } },
  leases: { orderBy: { address: "asc" as const } },
} as const;

function reject(result: { ok: false; status: 422 | 409; message: string }): never {
  if (result.status === 409) throw new ConflictError(result.message);
  throw new ValidationError([{ path: "body", message: result.message }]);
}

function requirePrefix(cidr: string) {
  const parsed = parsePrefix(cidr);
  if (!parsed.ok) throw new ValidationError([{ path: "cidr", message: "Préfixe CIDR invalide" }]);
  return parsed.prefix;
}

function canonicalAddress(value: string, path: string) {
  const parsed = parseAddress(value);
  if (!parsed) throw new ValidationError([{ path, message: "Adresse IP invalide" }]);
  return parsed.text;
}

function canonicalDns(values: string[]) {
  const servers: string[] = [];
  for (const value of values) {
    const address = canonicalAddress(value, "dnsServers");
    if (servers.includes(address)) throw new ValidationError([{ path: "dnsServers", message: `Le serveur DNS ${address} est en double` }]);
    servers.push(address);
  }
  return servers;
}

function canonicalMac(value: string) {
  const mac = normalizeMac(value);
  if (!mac) throw new ValidationError([{ path: "macAddress", message: "Adresse MAC invalide" }]);
  return mac;
}

function canonicalHostname(value: string | null | undefined) {
  if (value === undefined) return undefined;
  if (value === null || value.trim() === "") return null;
  const hostname = normalizeHostname(value);
  if (!isHostname(hostname)) throw new ValidationError([{ path: "hostname", message: "Nom d'hôte invalide" }]);
  return hostname;
}

function rethrowUnique(error: unknown, message: string): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new ConflictError(message);
  throw error;
}

async function requireOrganization(user: AuthUser, organizationId: string, permission: "inventory:read" | "inventory:write" | "inventory:delete") {
  const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true } });
  if (!organization) throw new NotFoundError("Organisation introuvable");
  assertPermission(user, organizationId, permission, "Organisation introuvable");
}

async function loadScope(scopeId: string) {
  const scope = await prisma.dhcpScope.findUnique({ where: { id: scopeId }, include: scopeInclude });
  if (!scope) throw new NotFoundError("Scope DHCP introuvable");
  return scope;
}

function mapScope(scope: Awaited<ReturnType<typeof loadScope>>, now = new Date()) {
  const stats = describeScope({
    cidr: scope.subnet.cidr,
    gateway: scope.gateway,
    ipamGateway: scope.subnet.gatewayAddress?.address ?? null,
    pools: scope.pools,
    exclusions: scope.exclusions,
    reservations: scope.reservations,
    leases: scope.leases,
    now,
  });
  return {
    id: scope.id,
    enabled: scope.enabled,
    gateway: scope.gateway,
    dnsServers: scope.dnsServers,
    domain: scope.domain,
    leaseSeconds: scope.leaseSeconds,
    description: scope.description,
    mode: "SIMULATION" as const,
    server: scope.server,
    subnet: { id: scope.subnet.id, name: scope.subnet.name, cidr: scope.subnet.cidr },
    vlan: scope.subnet.vlan,
    site: scope.subnet.network.site,
    organizationId: scope.subnet.network.site.organizationId,
    pools: scope.pools.map((pool) => ({ id: pool.id, start: pool.startAddress, end: pool.endAddress })),
    exclusions: scope.exclusions.map((exclusion) => ({ id: exclusion.id, start: exclusion.startAddress, end: exclusion.endAddress, reason: exclusion.reason })),
    reservations: scope.reservations.map((reservation) => ({
      id: reservation.id,
      address: reservation.address,
      macAddress: reservation.macAddress,
      hostname: reservation.hostname,
      description: reservation.description,
    })),
    leases: scope.leases.map((lease) => ({
      id: lease.id,
      address: lease.address,
      macAddress: lease.macAddress,
      hostname: lease.hostname,
      state: isLeaseActive(lease, now) ? "ACTIVE" : lease.state === "ACTIVE" ? "EXPIRED" : lease.state,
      origin: lease.origin,
      startsAt: lease.startsAt,
      expiresAt: lease.expiresAt,
    })),
    stats,
    issues: stats.issues,
  };
}

export async function dhcpOverview(user: AuthUser, organizationId: string, query: { siteId?: string }) {
  await requireOrganization(user, organizationId, "inventory:read");
  if (query.siteId) {
    const site = await prisma.site.findFirst({ where: { id: query.siteId, organizationId }, select: { id: true } });
    if (!site) throw new NotFoundError("Site introuvable");
  }
  const now = new Date();
  const [servers, scopes, relays] = await Promise.all([
    prisma.dhcpServer.findMany({
      where: { organizationId, siteId: query.siteId },
      include: { site: { select: { id: true, name: true, code: true } }, device: { select: { id: true, hostname: true } }, _count: { select: { scopes: true, relays: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.dhcpScope.findMany({
      where: { subnet: { network: { organizationId, siteId: query.siteId } } },
      include: scopeInclude,
      orderBy: { subnet: { cidr: "asc" } },
    }),
    prisma.dhcpRelay.findMany({
      where: { subnet: { network: { organizationId, siteId: query.siteId } } },
      include: {
        server: { select: { id: true, name: true, address: true } },
        interface: { select: { id: true, name: true, device: { select: { id: true, hostname: true } } } },
        subnet: { select: { id: true, cidr: true, vlan: { select: { id: true, vid: true, name: true } } } },
      },
      orderBy: { helperAddress: "asc" },
    }),
  ]);
  const mapped = scopes.map((scope) => mapScope(scope, now));
  let capacity = 0n;
  let used = 0n;
  let available = 0n;
  const alerts = mapped.flatMap((scope) => scope.issues.map((issue) => ({ ...issue, scopeId: scope.id, cidr: scope.subnet.cidr, vlan: scope.vlan })));
  for (const scope of mapped) {
    capacity += BigInt(scope.stats.capacity);
    used += BigInt(scope.stats.used);
    available += BigInt(scope.stats.available);
  }
  const leases = mapped.flatMap((scope) =>
    scope.leases
      .filter((lease) => lease.state === "ACTIVE")
      .map((lease) => ({ ...lease, scopeId: scope.id, cidr: scope.subnet.cidr, vlan: scope.vlan })),
  );
  return {
    mode: "SIMULATION" as const,
    notice: "Gestion et simulation. Aucun serveur DHCP réel n'est contacté.",
    organizationId,
    totals: {
      scopes: mapped.length,
      servers: servers.length,
      activeLeases: leases.length,
      capacity: capacity.toString(),
      used: used.toString(),
      available: available.toString(),
      utilization: capacity === 0n ? 0 : Number((used * 10000n) / capacity) / 100,
    },
    alerts,
    servers: servers.map((server) => ({
      id: server.id,
      name: server.name,
      description: server.description,
      address: server.address,
      status: server.status,
      mode: "SIMULATION" as const,
      site: server.site,
      device: server.device,
      counts: server._count,
    })),
    scopes: mapped.map((scope) => ({
      id: scope.id,
      enabled: scope.enabled,
      gateway: scope.gateway,
      dnsServers: scope.dnsServers,
      domain: scope.domain,
      leaseSeconds: scope.leaseSeconds,
      server: { id: scope.server.id, name: scope.server.name, address: scope.server.address, status: scope.server.status },
      subnet: scope.subnet,
      vlan: scope.vlan,
      site: scope.site,
      pools: scope.pools,
      stats: {
        capacity: scope.stats.capacity,
        used: scope.stats.used,
        available: scope.stats.available,
        utilization: scope.stats.utilization,
        exhausted: scope.stats.exhausted,
        activeLeases: scope.stats.activeLeases,
      },
      issues: scope.issues,
    })),
    leases,
    relays: relays.map((relay) => ({
      id: relay.id,
      helperAddress: relay.helperAddress,
      description: relay.description,
      server: relay.server,
      interface: relay.interface,
      subnet: relay.subnet,
    })),
  };
}

async function assertServerAddress(organizationId: string, address: string | null, exceptId?: string) {
  if (!address) return;
  const existing = await prisma.dhcpServer.findFirst({
    where: { organizationId, address, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { name: true },
  });
  if (existing) throw new ConflictError(`L'adresse ${address} est déjà utilisée par le serveur ${existing.name}`);
}

async function assertDevice(organizationId: string, siteId: string, deviceId: string | null | undefined) {
  if (!deviceId) return null;
  const device = await prisma.device.findFirst({ where: { id: deviceId, organizationId }, select: { id: true, siteId: true, hostname: true } });
  if (!device) throw new NotFoundError("Équipement introuvable");
  if (device.siteId !== siteId) throw new ValidationError([{ path: "deviceId", message: "L'équipement doit appartenir au site du serveur DHCP" }]);
  return device.id;
}

export async function createDhcpServer(
  user: AuthUser,
  organizationId: string,
  input: { siteId: string; name: string; description?: string | null; address?: string; deviceId?: string; status?: "PLANNED" | "ACTIVE" | "DISABLED" },
) {
  await requireOrganization(user, organizationId, "inventory:write");
  const site = await prisma.site.findFirst({ where: { id: input.siteId, organizationId }, select: { id: true } });
  if (!site) throw new NotFoundError("Site introuvable");
  const address = input.address ? canonicalAddress(input.address, "address") : null;
  const deviceId = await assertDevice(organizationId, site.id, input.deviceId);
  await assertServerAddress(organizationId, address);
  try {
    const server = await prisma.dhcpServer.create({
      data: {
        organizationId,
        siteId: site.id,
        name: input.name.trim(),
        description: blankToNull(input.description) ?? null,
        address,
        deviceId,
        status: input.status ?? "PLANNED",
      },
    });
    await recordAudit({
      actor: user,
      organizationId,
      action: "dhcp-server.create",
      resourceType: "DhcpServer",
      resourceId: server.id,
      metadata: { name: server.name, address: server.address, mode: "SIMULATION" },
    });
    return { ...server, mode: "SIMULATION" as const };
  } catch (error) {
    rethrowUnique(error, "Ce nom de serveur DHCP existe déjà sur ce site");
  }
}

export async function updateDhcpServer(
  user: AuthUser,
  serverId: string,
  input: { name?: string; description?: string | null; address?: string; deviceId?: string; status?: "PLANNED" | "ACTIVE" | "DISABLED" },
) {
  const current = await prisma.dhcpServer.findUnique({ where: { id: serverId } });
  if (!current) throw new NotFoundError("Serveur DHCP introuvable");
  assertPermission(user, current.organizationId, "inventory:write", "Serveur DHCP introuvable");
  const address = input.address !== undefined ? canonicalAddress(input.address, "address") : undefined;
  if (address) await assertServerAddress(current.organizationId, address, current.id);
  const deviceId = input.deviceId !== undefined ? await assertDevice(current.organizationId, current.siteId, input.deviceId) : undefined;
  try {
    const server = await prisma.dhcpServer.update({
      where: { id: current.id },
      data: {
        name: input.name?.trim(),
        description: input.description !== undefined ? (blankToNull(input.description) ?? null) : undefined,
        address,
        deviceId,
        status: input.status,
      },
    });
    await recordAudit({
      actor: user,
      organizationId: current.organizationId,
      action: "dhcp-server.update",
      resourceType: "DhcpServer",
      resourceId: server.id,
      metadata: { name: server.name, address: server.address },
    });
    return { ...server, mode: "SIMULATION" as const };
  } catch (error) {
    rethrowUnique(error, "Ce nom de serveur DHCP existe déjà sur ce site");
  }
}

export async function deleteDhcpServer(user: AuthUser, serverId: string) {
  const current = await prisma.dhcpServer.findUnique({ where: { id: serverId }, include: { _count: { select: { scopes: true, relays: true } } } });
  if (!current) throw new NotFoundError("Serveur DHCP introuvable");
  assertPermission(user, current.organizationId, "inventory:delete", "Serveur DHCP introuvable");
  if (current._count.scopes > 0) throw new ConflictError("Ce serveur porte des scopes. Retirez-les avant de le supprimer.");
  if (current._count.relays > 0) throw new ConflictError("Ce serveur est la cible de relais DHCP. Retirez-les avant de le supprimer.");
  await recordAudit({
    actor: user,
    organizationId: current.organizationId,
    action: "dhcp-server.delete",
    resourceType: "DhcpServer",
    resourceId: current.id,
    metadata: { name: current.name },
  });
  await prisma.dhcpServer.delete({ where: { id: current.id } });
  return { ok: true };
}

export async function createDhcpScope(
  user: AuthUser,
  organizationId: string,
  input: {
    subnetId: string;
    serverId: string;
    gateway?: string;
    dnsServers?: string[];
    domain?: string;
    leaseSeconds?: number;
    enabled?: boolean;
    description?: string | null;
    pool?: { start: string; end: string };
  },
) {
  await requireOrganization(user, organizationId, "inventory:write");
  const subnet = await prisma.ipSubnet.findUnique({
    where: { id: input.subnetId },
    include: { network: { select: { organizationId: true, siteId: true } }, gatewayAddress: { select: { address: true } }, dhcpScope: { select: { id: true } } },
  });
  if (!subnet || subnet.network.organizationId !== organizationId) throw new NotFoundError("Sous-réseau introuvable");
  if (subnet.dhcpScope) throw new ConflictError("Ce sous-réseau a déjà un scope DHCP");
  const server = await prisma.dhcpServer.findFirst({ where: { id: input.serverId, organizationId }, select: { id: true, siteId: true, name: true } });
  if (!server) throw new NotFoundError("Serveur DHCP introuvable");
  if (server.siteId !== subnet.network.siteId) {
    throw new ValidationError([{ path: "serverId", message: "Le serveur DHCP doit appartenir au site du sous-réseau" }]);
  }
  const prefix = requirePrefix(subnet.cidr);
  const gateway = input.gateway ? canonicalAddress(input.gateway, "gateway") : subnet.gatewayAddress?.address;
  if (!gateway) throw new ValidationError([{ path: "gateway", message: "La passerelle est obligatoire lorsque le sous-réseau n'en a pas" }]);
  const invalidGateway = gatewayIssue(prefix, gateway);
  if (invalidGateway) throw new ValidationError([{ path: "gateway", message: invalidGateway }]);
  const dnsServers = canonicalDns(input.dnsServers ?? []);
  const domain = input.domain ? canonicalHostname(input.domain) : null;
  const pool = input.pool ? poolIssue(prefix, [], input.pool.start, input.pool.end) : null;
  if (pool && !pool.ok) reject(pool);
  const created = await prisma.dhcpScope.create({
    data: {
      subnetId: subnet.id,
      serverId: server.id,
      gateway,
      dnsServers,
      domain: typeof domain === "string" ? domain : null,
      leaseSeconds: input.leaseSeconds ?? DEFAULT_LEASE_SECONDS,
      enabled: input.enabled ?? true,
      description: blankToNull(input.description) ?? null,
      pools: pool && pool.ok ? { create: { startAddress: pool.start, endAddress: pool.end } } : undefined,
    },
  });
  await recordAudit({
    actor: user,
    organizationId,
    action: "dhcp-scope.create",
    resourceType: "DhcpScope",
    resourceId: created.id,
    metadata: { cidr: subnet.cidr, gateway, dnsServers, server: server.name, mode: "SIMULATION" },
  });
  return getDhcpScope(user, created.id);
}

export async function getDhcpScope(user: AuthUser, scopeId: string) {
  const scope = await loadScope(scopeId);
  assertPermission(user, scope.subnet.network.site.organizationId, "inventory:read", "Scope DHCP introuvable");
  const relays = await prisma.dhcpRelay.findMany({
    where: { subnetId: scope.subnetId },
    include: { server: { select: { id: true, name: true, address: true } }, interface: { select: { id: true, name: true, device: { select: { hostname: true } } } } },
  });
  return { ...mapScope(scope), relays };
}

export async function updateDhcpScope(
  user: AuthUser,
  scopeId: string,
  input: { serverId?: string; gateway?: string; dnsServers?: string[]; domain?: string | null; leaseSeconds?: number; enabled?: boolean; description?: string | null },
) {
  const current = await loadScope(scopeId);
  const organizationId = current.subnet.network.site.organizationId;
  assertPermission(user, organizationId, "inventory:write", "Scope DHCP introuvable");
  const prefix = requirePrefix(current.subnet.cidr);
  let serverId = current.serverId;
  if (input.serverId && input.serverId !== current.serverId) {
    const server = await prisma.dhcpServer.findFirst({ where: { id: input.serverId, organizationId }, select: { id: true, siteId: true } });
    if (!server) throw new NotFoundError("Serveur DHCP introuvable");
    if (server.siteId !== current.subnet.network.site.id) {
      throw new ValidationError([{ path: "serverId", message: "Le serveur DHCP doit appartenir au site du sous-réseau" }]);
    }
    serverId = server.id;
  }
  const gateway = input.gateway ? canonicalAddress(input.gateway, "gateway") : current.gateway;
  const invalidGateway = gatewayIssue(prefix, gateway);
  if (invalidGateway) throw new ValidationError([{ path: "gateway", message: invalidGateway }]);
  const domain = input.domain === undefined ? undefined : canonicalHostname(input.domain);
  await prisma.dhcpScope.update({
    where: { id: current.id },
    data: {
      serverId,
      gateway,
      dnsServers: input.dnsServers ? canonicalDns(input.dnsServers) : undefined,
      domain: domain === undefined ? undefined : domain,
      leaseSeconds: input.leaseSeconds,
      enabled: input.enabled,
      description: input.description !== undefined ? (blankToNull(input.description) ?? null) : undefined,
    },
  });
  await recordAudit({
    actor: user,
    organizationId,
    action: "dhcp-scope.update",
    resourceType: "DhcpScope",
    resourceId: current.id,
    metadata: { gateway, domain: domain ?? current.domain },
  });
  return getDhcpScope(user, current.id);
}

export async function deleteDhcpScope(user: AuthUser, scopeId: string) {
  const current = await loadScope(scopeId);
  const organizationId = current.subnet.network.site.organizationId;
  assertPermission(user, organizationId, "inventory:delete", "Scope DHCP introuvable");
  await recordAudit({
    actor: user,
    organizationId,
    action: "dhcp-scope.delete",
    resourceType: "DhcpScope",
    resourceId: current.id,
    metadata: { cidr: current.subnet.cidr },
  });
  await prisma.dhcpScope.delete({ where: { id: current.id } });
  return { ok: true };
}

export async function createDhcpPool(user: AuthUser, scopeId: string, input: { start: string; end: string }) {
  const scope = await loadScope(scopeId);
  const organizationId = scope.subnet.network.site.organizationId;
  assertPermission(user, organizationId, "inventory:write", "Scope DHCP introuvable");
  const result = poolIssue(requirePrefix(scope.subnet.cidr), scope.pools, input.start, input.end);
  if (!result.ok) reject(result);
  const pool = await prisma.dhcpPool.create({ data: { scopeId: scope.id, startAddress: result.start, endAddress: result.end } });
  await recordAudit({
    actor: user,
    organizationId,
    action: "dhcp-pool.create",
    resourceType: "DhcpPool",
    resourceId: pool.id,
    metadata: { start: pool.startAddress, end: pool.endAddress, cidr: scope.subnet.cidr },
  });
  return { id: pool.id, start: pool.startAddress, end: pool.endAddress };
}

export async function deleteDhcpPool(user: AuthUser, poolId: string) {
  const pool = await prisma.dhcpPool.findUnique({ where: { id: poolId }, include: { scope: { include: { subnet: { include: { network: { select: { site: { select: { organizationId: true } } } } } } } } } });
  if (!pool) throw new NotFoundError("Pool DHCP introuvable");
  const organizationId = pool.scope.subnet.network.site.organizationId;
  assertPermission(user, organizationId, "inventory:delete", "Pool DHCP introuvable");
  await prisma.dhcpPool.delete({ where: { id: pool.id } });
  await recordAudit({ actor: user, organizationId, action: "dhcp-pool.delete", resourceType: "DhcpPool", resourceId: pool.id, metadata: { start: pool.startAddress, end: pool.endAddress } });
  return { ok: true };
}

export async function createDhcpExclusion(user: AuthUser, scopeId: string, input: { start: string; end: string; reason?: string | null }) {
  const scope = await loadScope(scopeId);
  const organizationId = scope.subnet.network.site.organizationId;
  assertPermission(user, organizationId, "inventory:write", "Scope DHCP introuvable");
  const result = exclusionIssue(requirePrefix(scope.subnet.cidr), input.start, input.end);
  if (!result.ok) throw new ValidationError([{ path: "start", message: result.message }]);
  const exclusion = await prisma.dhcpExclusion.create({
    data: { scopeId: scope.id, startAddress: result.start, endAddress: result.end, reason: blankToNull(input.reason) ?? null },
  });
  await recordAudit({
    actor: user,
    organizationId,
    action: "dhcp-exclusion.create",
    resourceType: "DhcpExclusion",
    resourceId: exclusion.id,
    metadata: { start: exclusion.startAddress, end: exclusion.endAddress },
  });
  return { id: exclusion.id, start: exclusion.startAddress, end: exclusion.endAddress, reason: exclusion.reason };
}

export async function deleteDhcpExclusion(user: AuthUser, exclusionId: string) {
  const exclusion = await prisma.dhcpExclusion.findUnique({ where: { id: exclusionId }, include: { scope: { include: { subnet: { include: { network: { select: { site: { select: { organizationId: true } } } } } } } } } });
  if (!exclusion) throw new NotFoundError("Exclusion DHCP introuvable");
  const organizationId = exclusion.scope.subnet.network.site.organizationId;
  assertPermission(user, organizationId, "inventory:delete", "Exclusion DHCP introuvable");
  await prisma.dhcpExclusion.delete({ where: { id: exclusion.id } });
  return { ok: true };
}

export async function createDhcpReservation(
  user: AuthUser,
  scopeId: string,
  input: { address: string; macAddress: string; hostname?: string; description?: string | null },
) {
  const scope = await loadScope(scopeId);
  const organizationId = scope.subnet.network.site.organizationId;
  assertPermission(user, organizationId, "inventory:write", "Scope DHCP introuvable");
  const macAddress = canonicalMac(input.macAddress);
  const result = reservationIssue(requirePrefix(scope.subnet.cidr), scope.gateway, scope.exclusions, scope.reservations, scope.leases, { address: input.address, macAddress }, new Date());
  if (!result.ok) reject(result);
  try {
    const reservation = await prisma.dhcpReservation.create({
      data: {
        scopeId: scope.id,
        address: result.address,
        macAddress: result.macAddress,
        hostname: canonicalHostname(input.hostname) ?? null,
        description: blankToNull(input.description) ?? null,
      },
    });
    await recordAudit({
      actor: user,
      organizationId,
      action: "dhcp-reservation.create",
      resourceType: "DhcpReservation",
      resourceId: reservation.id,
      metadata: { address: reservation.address, macAddress: reservation.macAddress },
    });
    return reservation;
  } catch (error) {
    rethrowUnique(error, "Cette réservation est en conflit avec une réservation existante");
  }
}

export async function deleteDhcpReservation(user: AuthUser, reservationId: string) {
  const reservation = await prisma.dhcpReservation.findUnique({
    where: { id: reservationId },
    include: { scope: { include: { subnet: { include: { network: { select: { site: { select: { organizationId: true } } } } } } } } },
  });
  if (!reservation) throw new NotFoundError("Réservation DHCP introuvable");
  const organizationId = reservation.scope.subnet.network.site.organizationId;
  assertPermission(user, organizationId, "inventory:delete", "Réservation DHCP introuvable");
  await prisma.dhcpReservation.delete({ where: { id: reservation.id } });
  return { ok: true };
}

async function saveLease(scopeId: string, address: string, macAddress: string, hostname: string | null, leaseSeconds: number) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + leaseSeconds * 1000);
  return prisma.$transaction(async (tx) => {
    await tx.dhcpLease.updateMany({
      where: { scopeId, macAddress, state: "ACTIVE", NOT: { address } },
      data: { state: "RELEASED" },
    });
    return tx.dhcpLease.upsert({
      where: { scopeId_address: { scopeId, address } },
      create: { scopeId, address, macAddress, hostname, state: "ACTIVE", origin: "SIMULATION", startsAt: now, expiresAt },
      update: { macAddress, hostname, state: "ACTIVE", origin: "SIMULATION", startsAt: now, expiresAt },
    });
  });
}

export async function simulateDhcpLease(user: AuthUser, scopeId: string, input: { macAddress: string; hostname?: string }) {
  const scope = await loadScope(scopeId);
  const organizationId = scope.subnet.network.site.organizationId;
  assertPermission(user, organizationId, "inventory:write", "Scope DHCP introuvable");
  if (!scope.enabled) throw new ConflictError("Ce scope DHCP est désactivé");
  const macAddress = canonicalMac(input.macAddress);
  const selected = selectLeaseAddress({
    prefix: requirePrefix(scope.subnet.cidr),
    gateway: scope.gateway,
    pools: scope.pools,
    exclusions: scope.exclusions,
    reservations: scope.reservations,
    leases: scope.leases,
    macAddress,
    now: new Date(),
  });
  if (!selected.ok) throw new ConflictError(selected.message);
  const hostname = canonicalHostname(input.hostname) ?? null;
  const lease = await saveLease(scope.id, selected.address, macAddress, hostname, scope.leaseSeconds);
  await recordAudit({
    actor: user,
    organizationId,
    action: "dhcp-lease.simulate",
    resourceType: "DhcpLease",
    resourceId: lease.id,
    metadata: { address: lease.address, macAddress: lease.macAddress, origin: "SIMULATION" },
  });
  return { ...lease, mode: "SIMULATION" as const };
}

export async function createDhcpLease(user: AuthUser, scopeId: string, input: { address: string; macAddress: string; hostname?: string }) {
  const scope = await loadScope(scopeId);
  const organizationId = scope.subnet.network.site.organizationId;
  assertPermission(user, organizationId, "inventory:write", "Scope DHCP introuvable");
  if (!scope.enabled) throw new ConflictError("Ce scope DHCP est désactivé");
  const macAddress = canonicalMac(input.macAddress);
  const result = manualLeaseIssue({
    prefix: requirePrefix(scope.subnet.cidr),
    gateway: scope.gateway,
    pools: scope.pools,
    exclusions: scope.exclusions,
    reservations: scope.reservations,
    leases: scope.leases,
    address: input.address,
    macAddress,
    now: new Date(),
  });
  if (!result.ok) reject(result);
  const lease = await saveLease(scope.id, result.address, macAddress, canonicalHostname(input.hostname) ?? null, scope.leaseSeconds);
  await recordAudit({
    actor: user,
    organizationId,
    action: "dhcp-lease.create",
    resourceType: "DhcpLease",
    resourceId: lease.id,
    metadata: { address: lease.address, macAddress: lease.macAddress, origin: "SIMULATION" },
  });
  return { ...lease, mode: "SIMULATION" as const };
}

export async function deleteDhcpLease(user: AuthUser, leaseId: string) {
  const lease = await prisma.dhcpLease.findUnique({
    where: { id: leaseId },
    include: { scope: { include: { subnet: { include: { network: { select: { site: { select: { organizationId: true } } } } } } } } },
  });
  if (!lease) throw new NotFoundError("Bail DHCP introuvable");
  const organizationId = lease.scope.subnet.network.site.organizationId;
  assertPermission(user, organizationId, "inventory:delete", "Bail DHCP introuvable");
  await prisma.dhcpLease.delete({ where: { id: lease.id } });
  return { ok: true };
}

export async function createDhcpRelay(
  user: AuthUser,
  organizationId: string,
  input: { subnetId: string; serverId: string; interfaceId?: string; helperAddress: string; description?: string | null },
) {
  await requireOrganization(user, organizationId, "inventory:write");
  const subnet = await prisma.ipSubnet.findUnique({
    where: { id: input.subnetId },
    include: { network: { select: { organizationId: true, siteId: true } } },
  });
  if (!subnet || subnet.network.organizationId !== organizationId) throw new NotFoundError("Sous-réseau introuvable");
  const server = await prisma.dhcpServer.findFirst({ where: { id: input.serverId, organizationId }, select: { id: true, siteId: true, address: true, name: true } });
  if (!server) throw new NotFoundError("Serveur DHCP introuvable");
  if (server.siteId !== subnet.network.siteId) {
    throw new ValidationError([{ path: "serverId", message: "Le relais et le serveur DHCP doivent appartenir au même site" }]);
  }
  if (!server.address) throw new ValidationError([{ path: "helperAddress", message: "Le serveur DHCP n'a pas d'adresse d'écoute" }]);
  const helperAddress = canonicalAddress(input.helperAddress, "helperAddress");
  if (helperAddress !== server.address) {
    throw new ValidationError([{ path: "helperAddress", message: "L'adresse de relais doit être l'adresse du serveur DHCP" }]);
  }
  let interfaceId: string | null = null;
  if (input.interfaceId) {
    const networkInterface = await prisma.networkInterface.findUnique({
      where: { id: input.interfaceId },
      include: { device: { select: { organizationId: true, siteId: true } } },
    });
    if (!networkInterface || networkInterface.device.organizationId !== organizationId) throw new NotFoundError("Interface introuvable");
    if (networkInterface.device.siteId !== subnet.network.siteId) {
      throw new ValidationError([{ path: "interfaceId", message: "L'interface de relais doit appartenir au site du sous-réseau" }]);
    }
    interfaceId = networkInterface.id;
  }
  try {
    const relay = await prisma.dhcpRelay.create({
      data: {
        subnetId: subnet.id,
        serverId: server.id,
        interfaceId,
        helperAddress,
        description: blankToNull(input.description) ?? null,
      },
    });
    await recordAudit({
      actor: user,
      organizationId,
      action: "dhcp-relay.create",
      resourceType: "DhcpRelay",
      resourceId: relay.id,
      metadata: { helperAddress, server: server.name, cidr: subnet.cidr },
    });
    return relay;
  } catch (error) {
    rethrowUnique(error, "Ce sous-réseau est déjà relayé vers ce serveur DHCP");
  }
}

export async function deleteDhcpRelay(user: AuthUser, relayId: string) {
  const relay = await prisma.dhcpRelay.findUnique({
    where: { id: relayId },
    include: { subnet: { include: { network: { select: { site: { select: { organizationId: true } } } } } } },
  });
  if (!relay) throw new NotFoundError("Relais DHCP introuvable");
  const organizationId = relay.subnet.network.site.organizationId;
  assertPermission(user, organizationId, "inventory:delete", "Relais DHCP introuvable");
  await prisma.dhcpRelay.delete({ where: { id: relay.id } });
  return { ok: true };
}
