import { Prisma } from "../../../generated/prisma/client";
import { recordAudit } from "../audit";
import type { AuthUser } from "../auth/context";
import {
  DNS_NOTICE,
  addressFromPtr,
  collectIssues,
  prepareRecord,
  recordFqdn,
  resolveLocal,
  reverseZoneName,
  type DnsType,
  type StoredRecord,
  type ZoneSnapshot,
  isHostName,
  normalizeDnsName,
  prefixOf,
} from "../dns/records";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import { containsAddress, parseAddress, parsePrefix } from "../ipam/address";
import { prisma } from "../prisma";
import { assertPermission } from "../rbac/guard";
import { blankToNull } from "../validation/network";

const zoneInclude = {
  server: { select: { id: true, name: true, address: true, status: true, siteId: true, organizationId: true, device: { select: { id: true, hostname: true } } } },
  subnet: { select: { id: true, name: true, cidr: true, vlan: { select: { id: true, vid: true, name: true } }, network: { select: { site: { select: { id: true, name: true, code: true, organizationId: true } } } } } },
  records: { orderBy: [{ type: "asc" as const }, { name: "asc" as const }] },
};

function reject(result: { ok: false; status: 422 | 409; message: string }): never {
  if (result.status === 409) throw new ConflictError(result.message);
  throw new ValidationError([{ path: "body", message: result.message }]);
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

function canonicalAddress(value: string, path: string) {
  const parsed = parseAddress(value);
  if (!parsed) throw new ValidationError([{ path, message: "Adresse IP invalide" }]);
  return parsed.text;
}

async function loadZone(zoneId: string) {
  const zone = await prisma.dnsZone.findUnique({ where: { id: zoneId }, include: zoneInclude });
  if (!zone) throw new NotFoundError("Zone DNS introuvable");
  return zone;
}

function snapshot(zone: { id: string; name: string; kind: "FORWARD" | "REVERSE"; enabled: boolean; subnet: { cidr: string } | null; records: StoredRecord[] }): ZoneSnapshot {
  return { id: zone.id, name: zone.name, kind: zone.kind, enabled: zone.enabled, cidr: zone.subnet?.cidr ?? null, records: zone.records };
}

async function planOf(organizationId: string) {
  const subnets = await prisma.ipSubnet.findMany({
    where: { network: { organizationId } },
    select: {
      id: true,
      name: true,
      cidr: true,
      vlan: { select: { id: true, vid: true, name: true } },
      addresses: { select: { address: true, interface: { select: { device: { select: { id: true, hostname: true } } } } } },
    },
  });
  const devices = await prisma.device.findMany({
    where: { organizationId, managementIp: { not: null } },
    select: { id: true, hostname: true, managementIp: true },
  });
  return { subnets, devices };
}

type Placement = {
  address: string;
  device: { id: string; hostname: string } | null;
  subnet: { id: string; cidr: string; name: string } | null;
  vlan: { id: string; vid: number; name: string } | null;
};

function placeAddress(address: string, plan: Awaited<ReturnType<typeof planOf>>): Placement {
  const parsed = parseAddress(address);
  const containers = plan.subnets.flatMap((subnet) => {
    const prefix = parsePrefix(subnet.cidr);
    if (!parsed || !prefix.ok || !containsAddress(prefix.prefix, parsed)) return [];
    return [{ subnet, length: prefix.prefix.prefix }];
  });
  const best = containers.sort((left, right) => right.length - left.length)[0]?.subnet ?? null;
  const allocated = best?.addresses.find((item) => item.address === address)?.interface?.device ?? null;
  const manager = plan.devices.find((device) => device.managementIp === address);
  return {
    address,
    device: allocated ?? (manager ? { id: manager.id, hostname: manager.hostname } : null),
    subnet: best ? { id: best.id, cidr: best.cidr, name: best.name } : null,
    vlan: best?.vlan ?? null,
  };
}

function recordAddress(zone: ZoneSnapshot, record: StoredRecord) {
  if (record.type === "A" || record.type === "AAAA") return record.rdata;
  if (record.type === "PTR" && zone.cidr) {
    const prefix = prefixOf(zone.cidr);
    return prefix ? addressFromPtr(prefix, record.name) : null;
  }
  return null;
}

function mapRecord(zone: ZoneSnapshot, record: StoredRecord & { id: string }, plan: Awaited<ReturnType<typeof planOf>>) {
  const address = recordAddress(zone, record);
  return {
    id: record.id,
    name: record.name,
    fqdn: recordFqdn(zone.name, record.name),
    type: record.type,
    ttl: record.ttl,
    value: record.rdata,
    priority: record.priority,
    weight: record.weight,
    port: record.port,
    link: address ? placeAddress(address, plan) : null,
  };
}

async function remember(zoneId: string, actorId: string, action: string, summary: string) {
  await prisma.dnsChange.create({ data: { zoneId, actorId, action, summary } });
}

export async function dnsOverview(user: AuthUser, organizationId: string, query: { q?: string; siteId?: string }) {
  await requireOrganization(user, organizationId, "inventory:read");
  if (query.siteId) {
    const site = await prisma.site.findFirst({ where: { id: query.siteId, organizationId }, select: { id: true } });
    if (!site) throw new NotFoundError("Site introuvable");
  }
  const [servers, zones, plan] = await Promise.all([
    prisma.dnsServer.findMany({
      where: { organizationId, siteId: query.siteId },
      include: { site: { select: { id: true, name: true, code: true } }, device: { select: { id: true, hostname: true } }, _count: { select: { zones: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.dnsZone.findMany({
      where: { organizationId, server: query.siteId ? { siteId: query.siteId } : undefined },
      include: zoneInclude,
      orderBy: { name: "asc" },
    }),
    planOf(organizationId),
  ]);
  const snapshots = zones.map(snapshot);
  const issues = collectIssues(snapshots, plan.subnets.map((subnet) => subnet.cidr));
  const needle = query.q?.trim().toLowerCase();
  const mapped = zones.map((zone) => {
    const current = snapshot(zone);
    const records = zone.records.map((record) => mapRecord(current, record, plan));
    return {
      id: zone.id,
      name: zone.name,
      kind: zone.kind,
      ttl: zone.ttl,
      enabled: zone.enabled,
      description: zone.description,
      server: { id: zone.server.id, name: zone.server.name, address: zone.server.address, status: zone.server.status },
      subnet: zone.subnet ? { id: zone.subnet.id, name: zone.subnet.name, cidr: zone.subnet.cidr, vlan: zone.subnet.vlan } : null,
      records,
      issues: issues.filter((issue) => issue.zoneId === zone.id),
    };
  });
  const visible = needle
    ? mapped.filter((zone) => zone.name.includes(needle) || zone.records.some((record) => `${record.fqdn} ${record.value} ${record.type}`.toLowerCase().includes(needle)))
    : mapped;
  return {
    mode: "LOCAL" as const,
    notice: DNS_NOTICE,
    organizationId,
    totals: { servers: servers.length, zones: mapped.length, records: mapped.reduce((sum, zone) => sum + zone.records.length, 0), alerts: issues.length },
    alerts: issues,
    servers: servers.map((server) => ({
      id: server.id,
      name: server.name,
      description: server.description,
      address: server.address,
      status: server.status,
      mode: "LOCAL" as const,
      site: server.site,
      device: server.device,
      counts: server._count,
    })),
    zones: visible,
  };
}

async function assertDevice(organizationId: string, siteId: string, deviceId: string | null | undefined) {
  if (!deviceId) return null;
  const device = await prisma.device.findFirst({ where: { id: deviceId, organizationId }, select: { id: true, siteId: true } });
  if (!device) throw new NotFoundError("Équipement introuvable");
  if (device.siteId !== siteId) throw new ValidationError([{ path: "deviceId", message: "L'équipement doit appartenir au site du serveur DNS" }]);
  return device.id;
}

export async function createDnsServer(
  user: AuthUser,
  organizationId: string,
  input: { siteId: string; name: string; description?: string | null; address?: string; deviceId?: string; status?: "PLANNED" | "ACTIVE" | "DISABLED" },
) {
  await requireOrganization(user, organizationId, "inventory:write");
  const site = await prisma.site.findFirst({ where: { id: input.siteId, organizationId }, select: { id: true } });
  if (!site) throw new NotFoundError("Site introuvable");
  const address = input.address ? canonicalAddress(input.address, "address") : null;
  const deviceId = await assertDevice(organizationId, site.id, input.deviceId);
  try {
    const server = await prisma.dnsServer.create({
      data: { organizationId, siteId: site.id, deviceId, name: input.name.trim(), description: blankToNull(input.description) ?? null, address, status: input.status ?? "PLANNED" },
    });
    await recordAudit({ actor: user, organizationId, action: "dns-server.create", resourceType: "DnsServer", resourceId: server.id, metadata: { name: server.name, address, mode: "LOCAL" } });
    return { ...server, mode: "LOCAL" as const };
  } catch (error) {
    rethrowUnique(error, "Ce nom de serveur DNS existe déjà sur ce site");
  }
}

export async function updateDnsServer(
  user: AuthUser,
  serverId: string,
  input: { name?: string; description?: string | null; address?: string; deviceId?: string; status?: "PLANNED" | "ACTIVE" | "DISABLED" },
) {
  const current = await prisma.dnsServer.findUnique({ where: { id: serverId } });
  if (!current) throw new NotFoundError("Serveur DNS introuvable");
  assertPermission(user, current.organizationId, "inventory:write", "Serveur DNS introuvable");
  const address = input.address !== undefined ? canonicalAddress(input.address, "address") : undefined;
  const deviceId = input.deviceId !== undefined ? await assertDevice(current.organizationId, current.siteId, input.deviceId) : undefined;
  try {
    const server = await prisma.dnsServer.update({
      where: { id: current.id },
      data: { name: input.name?.trim(), description: input.description !== undefined ? (blankToNull(input.description) ?? null) : undefined, address, deviceId, status: input.status },
    });
    await recordAudit({ actor: user, organizationId: current.organizationId, action: "dns-server.update", resourceType: "DnsServer", resourceId: server.id, metadata: { name: server.name } });
    return { ...server, mode: "LOCAL" as const };
  } catch (error) {
    rethrowUnique(error, "Ce nom de serveur DNS existe déjà sur ce site");
  }
}

export async function deleteDnsServer(user: AuthUser, serverId: string) {
  const current = await prisma.dnsServer.findUnique({ where: { id: serverId }, include: { _count: { select: { zones: true } } } });
  if (!current) throw new NotFoundError("Serveur DNS introuvable");
  assertPermission(user, current.organizationId, "inventory:delete", "Serveur DNS introuvable");
  if (current._count.zones > 0) throw new ConflictError("Ce serveur porte des zones DNS. Retirez-les avant de le supprimer.");
  await recordAudit({ actor: user, organizationId: current.organizationId, action: "dns-server.delete", resourceType: "DnsServer", resourceId: current.id, metadata: { name: current.name } });
  await prisma.dnsServer.delete({ where: { id: current.id } });
  return { ok: true };
}

export async function createDnsZone(
  user: AuthUser,
  organizationId: string,
  input: { serverId: string; kind: "FORWARD" | "REVERSE"; name?: string; subnetId?: string; ttl?: number; description?: string | null },
) {
  await requireOrganization(user, organizationId, "inventory:write");
  const server = await prisma.dnsServer.findFirst({ where: { id: input.serverId, organizationId }, select: { id: true, siteId: true, name: true } });
  if (!server) throw new NotFoundError("Serveur DNS introuvable");
  let subnetId: string | null = null;
  let name = "";
  if (input.kind === "FORWARD") {
    const normalized = input.name ? normalizeDnsName(input.name) : null;
    if (!normalized || !isHostName(normalized)) throw new ValidationError([{ path: "name", message: "Nom de zone invalide" }]);
    name = normalized;
  } else {
    if (!input.subnetId) throw new ValidationError([{ path: "subnetId", message: "Une zone inverse doit être liée à un sous-réseau" }]);
    const subnet = await prisma.ipSubnet.findUnique({ where: { id: input.subnetId }, include: { network: { select: { organizationId: true, siteId: true } }, dnsZone: { select: { id: true } } } });
    if (!subnet || subnet.network.organizationId !== organizationId) throw new NotFoundError("Sous-réseau introuvable");
    if (subnet.network.siteId !== server.siteId) throw new ValidationError([{ path: "subnetId", message: "Le sous-réseau doit appartenir au site du serveur DNS" }]);
    if (subnet.dnsZone) throw new ConflictError("Ce sous-réseau a déjà une zone inverse");
    const prefix = prefixOf(subnet.cidr);
    const reversed = prefix ? reverseZoneName(prefix) : null;
    if (!reversed) throw new ValidationError([{ path: "subnetId", message: "Ce préfixe ne peut pas devenir une zone inverse" }]);
    subnetId = subnet.id;
    name = reversed;
  }
  try {
    const zone = await prisma.dnsZone.create({
      data: { organizationId, serverId: server.id, subnetId, kind: input.kind, name, ttl: input.ttl ?? 3600, description: blankToNull(input.description) ?? null },
    });
    await remember(zone.id, user.id, "zone.create", `Zone ${zone.kind === "FORWARD" ? "directe" : "inverse"} ${zone.name} créée`);
    await recordAudit({ actor: user, organizationId, action: "dns-zone.create", resourceType: "DnsZone", resourceId: zone.id, metadata: { name: zone.name, kind: zone.kind, mode: "LOCAL" } });
    return getDnsZone(user, zone.id);
  } catch (error) {
    rethrowUnique(error, "Cette zone DNS existe déjà");
  }
}

export async function getDnsZone(user: AuthUser, zoneId: string) {
  const zone = await loadZone(zoneId);
  const organizationId = zone.organizationId;
  assertPermission(user, organizationId, "inventory:read", "Zone DNS introuvable");
  const [zones, plan, changes] = await Promise.all([
    prisma.dnsZone.findMany({ where: { organizationId }, include: { subnet: { select: { cidr: true } }, records: true } }),
    planOf(organizationId),
    prisma.dnsChange.findMany({ where: { zoneId: zone.id }, include: { actor: { select: { id: true, name: true } } }, orderBy: { createdAt: "desc" }, take: 40 }),
  ]);
  const current = snapshot(zone);
  const issues = collectIssues(zones.map((item) => snapshot(item)), plan.subnets.map((subnet) => subnet.cidr)).filter((issue) => issue.zoneId === zone.id);
  const records = zone.records.map((record) => mapRecord(current, record, plan));
  const links = records.flatMap((record) => (record.link ? [record.link] : []));
  return {
    mode: "LOCAL" as const,
    notice: DNS_NOTICE,
    id: zone.id,
    organizationId,
    name: zone.name,
    kind: zone.kind,
    ttl: zone.ttl,
    enabled: zone.enabled,
    description: zone.description,
    server: zone.server,
    site: zone.subnet?.network.site ?? null,
    subnet: zone.subnet ? { id: zone.subnet.id, name: zone.subnet.name, cidr: zone.subnet.cidr, vlan: zone.subnet.vlan } : null,
    records,
    chain: {
      zone: { name: zone.name, kind: zone.kind },
      records: records.map((record) => ({ id: record.id, fqdn: record.fqdn, type: record.type, value: record.value })),
      addresses: uniqueBy(links, (link) => link.address),
      devices: uniqueBy(links.flatMap((link) => (link.device ? [link.device] : [])), (device) => device.id),
      subnets: uniqueBy(links.flatMap((link) => (link.subnet ? [link.subnet] : [])), (subnet) => subnet.id),
      vlans: uniqueBy(links.flatMap((link) => (link.vlan ? [link.vlan] : [])), (vlan) => vlan.id),
    },
    issues,
    history: changes.map((change) => ({ id: change.id, action: change.action, summary: change.summary, createdAt: change.createdAt, actor: change.actor })),
  };
}

function uniqueBy<T>(items: T[], key: (item: T) => string) {
  return [...new Map(items.map((item) => [key(item), item])).values()];
}

export async function updateDnsZone(user: AuthUser, zoneId: string, input: { serverId?: string; ttl?: number; enabled?: boolean; description?: string | null }) {
  const current = await loadZone(zoneId);
  assertPermission(user, current.organizationId, "inventory:write", "Zone DNS introuvable");
  if (input.serverId && input.serverId !== current.serverId) {
    const server = await prisma.dnsServer.findFirst({ where: { id: input.serverId, organizationId: current.organizationId }, select: { id: true, siteId: true } });
    if (!server) throw new NotFoundError("Serveur DNS introuvable");
    if (current.subnet && current.subnet.network.site.id !== server.siteId) {
      throw new ValidationError([{ path: "serverId", message: "Le serveur DNS doit appartenir au site du sous-réseau" }]);
    }
  }
  await prisma.dnsZone.update({
    where: { id: current.id },
    data: { serverId: input.serverId, ttl: input.ttl, enabled: input.enabled, description: input.description !== undefined ? (blankToNull(input.description) ?? null) : undefined },
  });
  await remember(current.id, user.id, "zone.update", `Zone ${current.name} modifiée`);
  await recordAudit({ actor: user, organizationId: current.organizationId, action: "dns-zone.update", resourceType: "DnsZone", resourceId: current.id, metadata: { name: current.name } });
  return getDnsZone(user, current.id);
}

export async function deleteDnsZone(user: AuthUser, zoneId: string) {
  const current = await loadZone(zoneId);
  assertPermission(user, current.organizationId, "inventory:delete", "Zone DNS introuvable");
  await recordAudit({ actor: user, organizationId: current.organizationId, action: "dns-zone.delete", resourceType: "DnsZone", resourceId: current.id, metadata: { name: current.name } });
  await prisma.dnsZone.delete({ where: { id: current.id } });
  return { ok: true };
}

export async function createDnsRecord(
  user: AuthUser,
  zoneId: string,
  input: { name: string; type: DnsType; value: string; ttl?: number; priority?: number; weight?: number; port?: number },
) {
  const zone = await loadZone(zoneId);
  assertPermission(user, zone.organizationId, "inventory:write", "Zone DNS introuvable");
  const prepared = prepareRecord(snapshot(zone), input, zone.records);
  if (!prepared.ok) reject(prepared);
  try {
    const record = await prisma.dnsRecord.create({ data: { zoneId: zone.id, ...prepared.record } });
    const label = `${record.type} ${recordFqdn(zone.name, record.name)}`;
    await remember(zone.id, user.id, "record.create", `${label} → ${record.rdata}`);
    await recordAudit({ actor: user, organizationId: zone.organizationId, action: "dns-record.create", resourceType: "DnsRecord", resourceId: record.id, metadata: { zone: zone.name, type: record.type, name: record.name, rdata: record.rdata, mode: "LOCAL" } });
    return record;
  } catch (error) {
    rethrowUnique(error, "Cet enregistrement existe déjà");
  }
}

export async function updateDnsRecord(
  user: AuthUser,
  recordId: string,
  input: { name?: string; type?: DnsType; value?: string; ttl?: number; priority?: number; weight?: number; port?: number },
) {
  const current = await prisma.dnsRecord.findUnique({ where: { id: recordId }, include: { zone: { include: zoneInclude } } });
  if (!current) throw new NotFoundError("Enregistrement DNS introuvable");
  assertPermission(user, current.zone.organizationId, "inventory:write", "Enregistrement DNS introuvable");
  const prepared = prepareRecord(
    snapshot(current.zone),
    {
      name: input.name ?? current.name,
      type: input.type ?? current.type,
      value: input.value ?? current.rdata,
      ttl: input.ttl ?? current.ttl,
      priority: input.priority ?? current.priority,
      weight: input.weight ?? current.weight,
      port: input.port ?? current.port,
    },
    current.zone.records.filter((record) => record.id !== current.id),
  );
  if (!prepared.ok) reject(prepared);
  try {
    const record = await prisma.dnsRecord.update({ where: { id: current.id }, data: prepared.record });
    await remember(current.zoneId, user.id, "record.update", `${record.type} ${recordFqdn(current.zone.name, record.name)} → ${record.rdata}`);
    await recordAudit({ actor: user, organizationId: current.zone.organizationId, action: "dns-record.update", resourceType: "DnsRecord", resourceId: record.id, metadata: { zone: current.zone.name, type: record.type, name: record.name } });
    return record;
  } catch (error) {
    rethrowUnique(error, "Cet enregistrement existe déjà");
  }
}

export async function deleteDnsRecord(user: AuthUser, recordId: string) {
  const current = await prisma.dnsRecord.findUnique({ where: { id: recordId }, include: { zone: { select: { id: true, name: true, organizationId: true } } } });
  if (!current) throw new NotFoundError("Enregistrement DNS introuvable");
  assertPermission(user, current.zone.organizationId, "inventory:delete", "Enregistrement DNS introuvable");
  await remember(current.zoneId, user.id, "record.delete", `${current.type} ${recordFqdn(current.zone.name, current.name)} retiré`);
  await recordAudit({ actor: user, organizationId: current.zone.organizationId, action: "dns-record.delete", resourceType: "DnsRecord", resourceId: current.id, metadata: { zone: current.zone.name, type: current.type, name: current.name } });
  await prisma.dnsRecord.delete({ where: { id: current.id } });
  return { ok: true };
}

export async function resolveDnsName(user: AuthUser, zoneId: string, input: { name: string; type?: DnsType }) {
  const zone = await loadZone(zoneId);
  assertPermission(user, zone.organizationId, "inventory:read", "Zone DNS introuvable");
  const zones = await prisma.dnsZone.findMany({ where: { organizationId: zone.organizationId }, include: { subnet: { select: { cidr: true } }, records: true } });
  const plan = await planOf(zone.organizationId);
  const result = resolveLocal(zones.map((item) => snapshot(item)), input.name, input.type);
  const answers = result.answers.map((answer) => ({ ...answer, link: answer.type === "A" || answer.type === "AAAA" ? placeAddress(answer.rdata, plan) : null }));
  await remember(zone.id, user.id, "resolve", `Test local de ${input.name}${input.type ? ` ${input.type}` : ""} : ${result.message}`);
  return { mode: "LOCAL" as const, notice: DNS_NOTICE, query: { name: input.name, type: input.type ?? null }, ...result, answers };
}
