import { recordAudit } from "../audit";
import type { AuthUser } from "../auth/context";
import {
  DIAGNOSTIC_NOTICE,
  GUIDE_STEPS,
  PROBE_NOTICE,
  authorizePort,
  guide,
  runProbe,
  type DiagnosticMode,
  type DiagnosticPort,
  type DiagnosticSnapshot,
  type GuideStep,
  type ProbeOutcome,
  type Statement,
  type ToolId,
} from "../diagnostics/evaluate";
import { NotFoundError, ValidationError } from "../errors";
import { prisma } from "../prisma";
import { assertPermission } from "../rbac/guard";

const portInclude = {
  device: { select: { hostname: true } },
  accessVlan: { select: { vid: true, name: true } },
  nativeVlan: { select: { vid: true, name: true } },
  allowedVlans: { include: { vlan: { select: { vid: true, name: true } } } },
  connectedDevice: { select: { hostname: true } },
} as const;

async function requireOrganization(user: AuthUser, organizationId: string, permission: "inventory:read" | "inventory:write" | "inventory:delete") {
  const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true } });
  if (!organization) throw new NotFoundError("Organisation introuvable");
  assertPermission(user, organizationId, permission, "Organisation introuvable");
}

export async function diagnosticOverview(user: AuthUser, organizationId: string, query: { deviceId?: string }) {
  await requireOrganization(user, organizationId, "inventory:read");
  const device = await resolveDevice(organizationId, query.deviceId);
  const snapshot = device ? await loadSnapshot(organizationId, device.id) : null;
  const sessions = await prisma.diagnosticSession.findMany({
    where: { organizationId },
    include: {
      device: { select: { id: true, hostname: true } },
      checks: { orderBy: { rank: "asc" } },
    },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  return {
    notice: DIAGNOSTIC_NOTICE,
    probeNotice: PROBE_NOTICE,
    steps: GUIDE_STEPS,
    device: device ? { id: device.id, hostname: device.hostname } : null,
    guide: snapshot ? guide(snapshot) : [],
    sessions: sessions.map(presentSession),
  };
}

export async function createGuide(user: AuthUser, organizationId: string, input: { deviceId: string }) {
  await requireOrganization(user, organizationId, "inventory:write");
  const snapshot = await loadSnapshot(organizationId, input.deviceId);
  const steps = guide(snapshot);
  const session = await prisma.diagnosticSession.create({
    data: {
      organizationId,
      deviceId: input.deviceId,
      actorId: user.id,
      tool: "GUIDE",
      mode: "INVENTORY",
      checks: { create: steps.map((item, rank) => checkData(rank, item)) },
    },
    include: sessionInclude,
  });
  await recordAudit({
    actor: user,
    organizationId,
    action: "diagnostic.guide",
    resourceType: "DiagnosticSession",
    resourceId: session.id,
    metadata: { deviceId: input.deviceId, hostname: snapshot.hostname },
  });
  return presentSession(session);
}

export async function createProbe(
  user: AuthUser,
  organizationId: string,
  input: { deviceId: string; tool: ToolId; mode: DiagnosticMode; port?: number; name?: string },
) {
  await requireOrganization(user, organizationId, "inventory:write");
  if (input.tool === "PORT") {
    const refusal = authorizePort(input.port ?? 0);
    if (refusal) throw new ValidationError({ port: [refusal] });
  }
  const snapshot = await loadSnapshot(organizationId, input.deviceId);
  const outcome = runProbe(input.tool, input.mode, snapshot, { port: input.port, name: input.name });
  const session = await prisma.diagnosticSession.create({
    data: {
      organizationId,
      deviceId: input.deviceId,
      actorId: user.id,
      tool: input.tool,
      mode: input.mode,
      checks: { create: [checkData(0, { ...outcome, step: input.tool, label: input.tool })] },
    },
    include: sessionInclude,
  });
  await recordAudit({
    actor: user,
    organizationId,
    action: "diagnostic.probe",
    resourceType: "DiagnosticSession",
    resourceId: session.id,
    metadata: { deviceId: input.deviceId, tool: input.tool, mode: input.mode, available: outcome.available },
  });
  return presentSession(session);
}

export async function deleteDiagnosticSession(user: AuthUser, sessionId: string) {
  const current = await prisma.diagnosticSession.findUnique({
    where: { id: sessionId },
    select: { id: true, organizationId: true, deviceId: true, tool: true },
  });
  if (!current) throw new NotFoundError("Diagnostic introuvable");
  await requireOrganization(user, current.organizationId, "inventory:delete");
  await prisma.diagnosticSession.delete({ where: { id: sessionId } });
  await recordAudit({
    actor: user,
    organizationId: current.organizationId,
    action: "diagnostic.delete",
    resourceType: "DiagnosticSession",
    resourceId: current.id,
    metadata: { deviceId: current.deviceId, tool: current.tool },
  });
  return { ok: true };
}

async function resolveDevice(organizationId: string, deviceId: string | undefined) {
  if (deviceId) {
    const device = await prisma.device.findFirst({ where: { id: deviceId, organizationId }, select: { id: true, hostname: true } });
    if (!device) throw new NotFoundError("Équipement introuvable");
    return device;
  }
  return (
    (await prisma.device.findFirst({ where: { organizationId, hostname: "pc-accueil" }, select: { id: true, hostname: true } })) ??
    (await prisma.device.findFirst({ where: { organizationId, role: "CLIENT" }, orderBy: { hostname: "asc" }, select: { id: true, hostname: true } })) ??
    (await prisma.device.findFirst({ where: { organizationId }, orderBy: { hostname: "asc" }, select: { id: true, hostname: true } }))
  );
}

async function loadSnapshot(organizationId: string, deviceId: string): Promise<DiagnosticSnapshot> {
  const device = await prisma.device.findFirst({
    where: { id: deviceId, organizationId },
    include: { interfaces: { orderBy: { name: "asc" } }, connectedPorts: { include: portInclude } },
  });
  if (!device) throw new NotFoundError("Équipement introuvable");
  const [sitePorts, subnets, layer3, routes, dnsRecords, dhcpServers] = await Promise.all([
    prisma.switchPort.findMany({ where: { device: { organizationId, siteId: device.siteId } }, include: portInclude, orderBy: { name: "asc" } }),
    prisma.ipSubnet.findMany({
      where: { network: { organizationId, siteId: device.siteId } },
      include: {
        vlan: { select: { vid: true, name: true } },
        gatewayAddress: { select: { address: true } },
        dhcpScope: { include: { server: { select: { name: true, status: true, address: true } } } },
        dhcpRelays: { include: { server: { select: { name: true } } } },
      },
    }),
    prisma.layer3Interface.findMany({
      where: { device: { organizationId } },
      include: { device: { select: { hostname: true } }, subnet: { select: { cidr: true } }, vlan: { select: { vid: true } } },
    }),
    prisma.route.findMany({
      where: { device: { organizationId }, status: "ACTIVE" },
      include: { device: { select: { hostname: true } } },
    }),
    prisma.dnsRecord.findMany({
      where: { zone: { organizationId } },
      include: { zone: { select: { name: true } } },
    }),
    prisma.dhcpServer.findMany({ where: { organizationId, siteId: device.siteId }, select: { name: true, status: true, address: true }, orderBy: { name: "asc" } }),
  ]);
  return {
    hostname: device.hostname,
    role: device.role,
    status: device.status,
    managementIp: device.managementIp,
    interfaces: device.interfaces.map((item) => ({ name: item.name, ipAddress: item.ipAddress, macAddress: item.macAddress, status: item.status })),
    connectedPorts: device.connectedPorts.map(presentPort),
    sitePorts: sitePorts.map(presentPort),
    subnets: subnets.map((subnet) => ({
      cidr: subnet.cidr,
      gateway: subnet.gatewayAddress?.address ?? null,
      vlan: subnet.vlan,
      relays: subnet.dhcpRelays.map((relay) => ({ helperAddress: relay.helperAddress, serverName: relay.server.name })),
      scope: subnet.dhcpScope
        ? { enabled: subnet.dhcpScope.enabled, serverName: subnet.dhcpScope.server.name, serverStatus: subnet.dhcpScope.server.status, serverAddress: subnet.dhcpScope.server.address }
        : null,
    })),
    layer3: layer3.map((item) => ({
      deviceHostname: item.device.hostname,
      name: item.name,
      address: item.address,
      cidr: item.subnet.cidr,
      vlanVid: item.vlan?.vid ?? null,
      status: item.status,
    })),
    routes: routes.map((route) => ({
      deviceHostname: route.device.hostname,
      cidr: route.cidr,
      gateway: route.gateway,
      protocol: route.protocol,
      status: route.status,
    })),
    dnsRecords: dnsRecords.map((record) => ({ zone: record.zone.name, name: record.name, type: record.type, rdata: record.rdata })),
    dhcpServers,
  };
}

function presentPort(port: {
  name: string;
  status: string;
  mode: string;
  device: { hostname: string };
  connectedDevice: { hostname: string } | null;
  accessVlan: { vid: number; name: string } | null;
  nativeVlan: { vid: number; name: string } | null;
  allowedVlans: Array<{ vlan: { vid: number; name: string } }>;
}): DiagnosticPort {
  return {
    name: port.name,
    switchHostname: port.device.hostname,
    status: port.status,
    mode: port.mode === "TRUNK" ? "TRUNK" : "ACCESS",
    connectedHostname: port.connectedDevice?.hostname ?? null,
    accessVlan: port.accessVlan,
    nativeVlan: port.nativeVlan,
    allowedVlans: port.allowedVlans.map((item) => item.vlan),
  };
}

const sessionInclude = {
  device: { select: { id: true, hostname: true } },
  checks: { orderBy: { rank: "asc" as const } },
};

function checkData(rank: number, item: (GuideStep | (ProbeOutcome & { step: string; label: string })) & Statement) {
  return {
    rank,
    step: item.step,
    label: item.label,
    available: item.available,
    fact: item.fact,
    observation: item.observation,
    possibleCause: item.possibleCause,
    recommendedCheck: item.recommendedCheck,
  };
}

function presentSession(session: {
  id: string;
  tool: string;
  mode: string;
  createdAt: Date;
  device: { id: string; hostname: string };
  checks: Array<{
    id: string;
    rank: number;
    step: string;
    label: string;
    available: boolean;
    fact: string;
    observation: string;
    possibleCause: string;
    recommendedCheck: string;
  }>;
}) {
  return {
    id: session.id,
    tool: session.tool,
    mode: session.mode,
    createdAt: session.createdAt.toISOString(),
    device: session.device,
    checks: session.checks.map((check) => ({
      id: check.id,
      rank: check.rank,
      step: check.step,
      label: check.label,
      available: check.available,
      fact: check.fact,
      observation: check.observation,
      possibleCause: check.possibleCause,
      recommendedCheck: check.recommendedCheck,
    })),
  };
}
