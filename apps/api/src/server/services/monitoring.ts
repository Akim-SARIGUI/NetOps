import { Prisma } from "../../../generated/prisma/client";
import { recordAudit } from "../audit";
import type { AuthUser } from "../auth/context";
import { describeScope } from "../dhcp/evaluate";
import { ConflictError, NotFoundError } from "../errors";
import { parsePrefix, summarize } from "../ipam/address";
import {
  COLLECTOR_NOTICE,
  MONITORING_NOTICE,
  collect,
  deviceAlerts,
  dhcpAlerts,
  dnsAlerts,
  round,
  weightedUtilization,
  type Sample,
} from "../monitoring/evaluate";
import { prisma } from "../prisma";
import { assertPermission } from "../rbac/guard";

function rethrowUnique(error: unknown, message: string): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new ConflictError(message);
  throw error;
}

async function requireOrganization(user: AuthUser, organizationId: string, permission: "inventory:read" | "inventory:write" | "inventory:delete") {
  const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true } });
  if (!organization) throw new NotFoundError("Organisation introuvable");
  assertPermission(user, organizationId, permission, "Organisation introuvable");
}

export async function monitoringDashboard(user: AuthUser, organizationId: string, query: { siteId?: string }) {
  await requireOrganization(user, organizationId, "inventory:read");
  const site = query.siteId ? { siteId: query.siteId } : {};
  const [targets, subnets, scopes, dnsServers] = await Promise.all([
    prisma.monitoringTarget.findMany({
      where: { organizationId, ...(query.siteId ? { device: { siteId: query.siteId } } : {}) },
      include: {
        device: {
          select: {
            id: true,
            hostname: true,
            role: true,
            status: true,
            siteId: true,
            interfaces: { select: { name: true, status: true, speedMbps: true }, orderBy: { name: "asc" } },
          },
        },
      },
      orderBy: { device: { hostname: "asc" } },
    }),
    prisma.ipSubnet.findMany({
      where: { network: { organizationId, ...site } },
      select: { cidr: true, vlan: { select: { id: true, vid: true, name: true } }, _count: { select: { addresses: true } } },
    }),
    prisma.dhcpScope.findMany({
      where: { enabled: true, subnet: { network: { organizationId, ...site } } },
      include: {
        subnet: { select: { cidr: true, gatewayAddress: { select: { address: true } }, vlan: { select: { vid: true, name: true } } } },
        pools: { orderBy: { startAddress: "asc" } },
        exclusions: { orderBy: { startAddress: "asc" } },
        reservations: { orderBy: { address: "asc" } },
        leases: { orderBy: { address: "asc" } },
      },
    }),
    prisma.dnsServer.findMany({ where: { organizationId, ...site }, select: { name: true, status: true } }),
  ]);

  const rows = targets.map((target) => {
    const snapshot = { hostname: target.device.hostname, status: target.device.status, interfaces: target.device.interfaces };
    const result = target.enabled ? collect(target.mode, snapshot) : null;
    const samples = result?.available ? result.samples : null;
    const alerts = target.enabled
      ? deviceAlerts({ hostname: target.device.hostname, packetLossThreshold: target.packetLossThreshold, samples, interfaces: target.device.interfaces })
      : [];
    const availability = valueOf(samples, "AVAILABILITY");
    const status = !target.enabled ? "DISABLED" : !result?.available ? "UNKNOWN" : availability === 1 ? "ONLINE" : "OFFLINE";
    return {
      id: target.id,
      mode: target.mode,
      enabled: target.enabled,
      packetLossThreshold: target.packetLossThreshold,
      status,
      simulated: target.mode === "SIMULATION",
      collectorMessage: result && !result.available ? result.message : null,
      device: { id: target.device.id, hostname: target.device.hostname, role: target.device.role, siteId: target.device.siteId, inventoryStatus: target.device.status },
      metrics: {
        availability,
        cpu: valueOf(samples, "CPU"),
        ram: valueOf(samples, "RAM"),
        latencyMs: valueOf(samples, "LATENCY"),
        packetLossPercent: valueOf(samples, "PACKET_LOSS"),
        uptimeSeconds: valueOf(samples, "UPTIME"),
        errors: valueOf(samples, "ERRORS"),
        interfaces: target.device.interfaces.map((iface) => ({
          name: iface.name,
          status: iface.status,
          trafficBps: samples?.find((sample) => sample.kind === "TRAFFIC" && sample.interfaceName === iface.name)?.value ?? null,
          errors: samples?.find((sample) => sample.kind === "ERRORS" && sample.interfaceName === iface.name)?.value ?? null,
        })),
      },
      alerts,
      samples,
    };
  });

  const enabled = rows.filter((row) => row.enabled);
  const onlineRows = enabled.filter((row) => row.status === "ONLINE");
  const addressUse = subnets.flatMap((subnet) => {
    const parsed = parsePrefix(subnet.cidr);
    if (!parsed.ok) return [];
    const stats = summarize(parsed.prefix, BigInt(subnet._count.addresses));
    return [{ vlan: subnet.vlan, used: Number(stats.used), usable: Number(stats.usable) }];
  });
  const vlanBuckets = new Map<string, { id: string; vid: number; name: string; used: number; usable: number }>();
  for (const item of addressUse) {
    const current = vlanBuckets.get(item.vlan.id) ?? { ...item.vlan, used: 0, usable: 0 };
    current.used += item.used;
    current.usable += item.usable;
    vlanBuckets.set(item.vlan.id, current);
  }
  const vlans = [...vlanBuckets.values()]
    .map((vlan) => ({ id: vlan.id, vid: vlan.vid, name: vlan.name, utilization: weightedUtilization([vlan]) }))
    .sort((left, right) => left.vid - right.vid);
  const dhcpScopes = scopes.map((scope) => {
    const stats = describeScope({
      cidr: scope.subnet.cidr,
      gateway: scope.gateway,
      ipamGateway: scope.subnet.gatewayAddress?.address ?? null,
      pools: scope.pools,
      exclusions: scope.exclusions,
      reservations: scope.reservations,
      leases: scope.leases,
    });
    return { label: `VLAN ${scope.subnet.vlan.vid} ${scope.subnet.cidr}`, utilization: stats.utilization, used: Number(stats.used), capacity: Number(stats.capacity) };
  });
  const deviceAlertRows = enabled.flatMap((row) => row.alerts.map((alert) => ({ ...alert, device: row.device.hostname })));
  const platformAlerts = [
    ...dhcpAlerts(dhcpScopes).map((alert) => ({ ...alert, device: null as string | null })),
    ...dnsAlerts(dnsServers).map((alert) => ({ ...alert, device: null })),
  ];
  return {
    mode: "SIMULATION" as const,
    notice: MONITORING_NOTICE,
    collectorNotice: COLLECTOR_NOTICE,
    organizationId,
    collectors: [
      { id: "SIMULATION" as const, available: true, message: MONITORING_NOTICE },
      { id: "ICMP" as const, available: false, message: "Le collecteur ICMP n'est pas intégré." },
      { id: "SNMP" as const, available: false, message: "Le collecteur SNMP n'est pas intégré." },
    ],
    totals: {
      devices: enabled.length,
      online: onlineRows.length,
      offline: enabled.filter((row) => row.status === "OFFLINE").length,
      unknown: enabled.filter((row) => row.status === "UNKNOWN").length,
      critical: enabled.filter((row) => row.alerts.length > 0).length,
      trafficBps: enabled.reduce((sum, row) => sum + (row.samples?.filter((sample) => sample.kind === "TRAFFIC").reduce((inner, sample) => inner + sample.value, 0) ?? 0), 0),
      latencyMs: average(onlineRows.map((row) => valueOf(row.samples, "LATENCY"))),
      packetLossPercent: average(onlineRows.map((row) => valueOf(row.samples, "PACKET_LOSS"))),
      vlanUtilization: vlans.length ? Math.max(...vlans.map((vlan) => vlan.utilization)) : 0,
      ipUtilization: weightedUtilization(addressUse),
      dhcpUtilization: weightedUtilization(dhcpScopes.map((scope) => ({ used: scope.used, usable: scope.capacity }))),
    },
    vlans,
    targets: rows.map(({ samples: _samples, ...row }) => row),
    alerts: [...deviceAlertRows, ...platformAlerts],
  };
}

export async function createMonitoringTarget(user: AuthUser, organizationId: string, input: { deviceId: string; mode?: "SIMULATION" | "ICMP" | "SNMP"; packetLossThreshold?: number }) {
  await requireOrganization(user, organizationId, "inventory:write");
  const device = await prisma.device.findFirst({ where: { id: input.deviceId, organizationId }, select: { id: true, hostname: true } });
  if (!device) throw new NotFoundError("Équipement introuvable");
  try {
    const target = await prisma.monitoringTarget.create({
      data: { organizationId, deviceId: device.id, mode: input.mode ?? "SIMULATION", packetLossThreshold: input.packetLossThreshold ?? 2 },
    });
    await recordAudit({ actor: user, organizationId, action: "monitoring.target.create", resourceType: "MonitoringTarget", resourceId: target.id, metadata: { hostname: device.hostname, mode: target.mode } });
    return { ...target, notice: MONITORING_NOTICE };
  } catch (error) {
    rethrowUnique(error, "Cet équipement est déjà supervisé");
  }
}

export async function updateMonitoringTarget(user: AuthUser, targetId: string, input: { mode?: "SIMULATION" | "ICMP" | "SNMP"; packetLossThreshold?: number; enabled?: boolean }) {
  const current = await prisma.monitoringTarget.findUnique({ where: { id: targetId }, include: { device: { select: { hostname: true } } } });
  if (!current) throw new NotFoundError("Cible de supervision introuvable");
  assertPermission(user, current.organizationId, "inventory:write", "Cible de supervision introuvable");
  const target = await prisma.monitoringTarget.update({
    where: { id: current.id },
    data: { mode: input.mode, packetLossThreshold: input.packetLossThreshold, enabled: input.enabled },
  });
  await recordAudit({ actor: user, organizationId: current.organizationId, action: "monitoring.target.update", resourceType: "MonitoringTarget", resourceId: target.id, metadata: { hostname: current.device.hostname, mode: target.mode } });
  return { ...target, notice: target.mode === "SIMULATION" ? MONITORING_NOTICE : COLLECTOR_NOTICE };
}

export async function deleteMonitoringTarget(user: AuthUser, targetId: string) {
  const current = await prisma.monitoringTarget.findUnique({ where: { id: targetId }, include: { device: { select: { hostname: true } } } });
  if (!current) throw new NotFoundError("Cible de supervision introuvable");
  assertPermission(user, current.organizationId, "inventory:delete", "Cible de supervision introuvable");
  await recordAudit({ actor: user, organizationId: current.organizationId, action: "monitoring.target.delete", resourceType: "MonitoringTarget", resourceId: current.id, metadata: { hostname: current.device.hostname } });
  await prisma.monitoringTarget.delete({ where: { id: current.id } });
  return { ok: true };
}

function valueOf(samples: Sample[] | null, kind: Sample["kind"]) {
  return samples?.find((sample) => sample.kind === kind && !sample.interfaceName)?.value ?? null;
}

function average(values: Array<number | null>) {
  const present = values.filter((value): value is number => value !== null);
  if (!present.length) return 0;
  return round(present.reduce((sum, value) => sum + value, 0) / present.length);
}
