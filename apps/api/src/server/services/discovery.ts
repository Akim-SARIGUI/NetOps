import { Prisma } from "../../../generated/prisma/client";
import { recordAudit } from "../audit";
import type { AuthUser } from "../auth/context";
import {
  CONNECTOR_NOTICE,
  DISCOVERY_NOTICE,
  connectorCatalog,
  decisionError,
  probe,
  simulateObservations,
  type ClassifiedObservation,
  type ConnectorId,
  type Decision,
  type InterfaceObservation,
  type NeighborObservation,
  type PortObservation,
  type VlanObservation,
} from "../discovery/evaluate";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import { prisma } from "../prisma";
import { assertPermission } from "../rbac/guard";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const runInclude = {
  site: { select: { id: true, name: true, code: true, environment: true } },
  probes: { orderBy: { connector: "asc" as const } },
  findings: {
    orderBy: { position: "asc" as const },
    include: {
      matchedDevice: { select: { id: true, hostname: true } },
      importedDevice: { select: { id: true, hostname: true, status: true } },
    },
  },
} satisfies Prisma.DiscoveryRunInclude;

type RunRecord = Prisma.DiscoveryRunGetPayload<{ include: typeof runInclude }>;

function rethrowUnique(error: unknown, message: string): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new ConflictError(message);
  throw error;
}

async function requireOrganization(user: AuthUser, organizationId: string, permission: "inventory:read" | "inventory:write" | "inventory:delete") {
  const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true } });
  if (!organization) throw new NotFoundError("Organisation introuvable");
  assertPermission(user, organizationId, permission, "Organisation introuvable");
}

function asList<T>(value: Prisma.JsonValue): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function present(run: RunRecord) {
  return {
    id: run.id,
    label: run.label,
    status: run.status,
    simulated: run.simulated,
    notice: run.simulated ? DISCOVERY_NOTICE : CONNECTOR_NOTICE,
    createdAt: run.createdAt.toISOString(),
    site: run.site,
    probes: run.probes.map((item) => ({ connector: item.connector, available: item.available, message: item.message })),
    findings: run.findings.map((finding) => ({
      id: finding.id,
      position: finding.position,
      verdict: finding.verdict,
      decision: finding.decision,
      simulated: finding.simulated,
      hostname: finding.hostname,
      ipAddress: finding.ipAddress,
      macAddress: finding.macAddress,
      role: finding.role,
      interfaces: asList<InterfaceObservation>(finding.interfaces),
      ports: asList<PortObservation>(finding.ports),
      vlans: asList<VlanObservation>(finding.vlans),
      neighbors: asList<NeighborObservation>(finding.neighbors),
      conflictReason: finding.conflictReason,
      matchedDevice: finding.matchedDevice,
      importedDevice: finding.importedDevice,
    })),
  };
}

async function loadInventory(organizationId: string) {
  const devices = await prisma.device.findMany({
    where: { organizationId },
    select: { id: true, hostname: true, managementIp: true, interfaces: { select: { macAddress: true } } },
  });
  return devices.map((device) => ({
    id: device.id,
    hostname: device.hostname,
    managementIp: device.managementIp,
    macAddresses: device.interfaces.flatMap((item) => (item.macAddress ? [item.macAddress] : [])),
  }));
}

async function loadRun(runId: string) {
  if (!UUID.test(runId)) throw new NotFoundError("Découverte introuvable");
  const run = await prisma.discoveryRun.findUnique({ where: { id: runId }, include: runInclude });
  if (!run) throw new NotFoundError("Découverte introuvable");
  return run;
}

export async function discoveryOverview(user: AuthUser, organizationId: string) {
  await requireOrganization(user, organizationId, "inventory:read");
  const runs = await prisma.discoveryRun.findMany({
    where: { organizationId },
    include: runInclude,
    orderBy: { createdAt: "desc" },
  });
  return {
    notice: DISCOVERY_NOTICE,
    connectorNotice: CONNECTOR_NOTICE,
    organizationId,
    connectors: connectorCatalog(),
    runs: runs.map(present),
  };
}

export async function createDiscoveryRun(
  user: AuthUser,
  organizationId: string,
  input: { label?: string; siteId?: string; connectors: ConnectorId[] },
) {
  await requireOrganization(user, organizationId, "inventory:write");
  const connectors = [...new Set(input.connectors)];
  if (input.siteId) {
    const site = await prisma.site.findFirst({ where: { id: input.siteId, organizationId }, select: { id: true } });
    if (!site) throw new NotFoundError("Site introuvable");
  }
  const probes = connectors.map((connector) => probe(connector));
  const simulated = probes.some((item) => item.connector === "SIMULATION" && item.available);
  const findings = simulated ? simulateObservations(await loadInventory(organizationId)) : [];
  try {
    const run = await prisma.discoveryRun.create({
      data: {
        organizationId,
        siteId: input.siteId ?? null,
        label: input.label?.trim() || "Découverte",
        status: "DISCOVERY",
        simulated,
        probes: { create: probes },
        findings: { create: findings.map((finding, position) => findingData(finding, position)) },
      },
      include: runInclude,
    });
    await recordAudit({
      actor: user,
      organizationId,
      action: "discovery.run.create",
      resourceType: "DiscoveryRun",
      resourceId: run.id,
      metadata: { connectors, simulated, findings: findings.length },
    });
    return present(run);
  } catch (error) {
    rethrowUnique(error, "Cette découverte existe déjà");
  }
}

export async function reviewDiscoveryRun(user: AuthUser, runId: string) {
  const current = await loadRun(runId);
  assertPermission(user, current.organizationId, "inventory:write", "Découverte introuvable");
  if (current.status !== "DISCOVERY") {
    throw new ValidationError([{ path: "status", message: "Cette découverte n'est plus à l'étape Découverte." }]);
  }
  const run = await prisma.discoveryRun.update({ where: { id: current.id }, data: { status: "REVIEW" }, include: runInclude });
  await recordAudit({ actor: user, organizationId: current.organizationId, action: "discovery.run.review", resourceType: "DiscoveryRun", resourceId: current.id });
  return present(run);
}

export async function approveDiscoveryRun(user: AuthUser, runId: string, input: { decisions: Array<{ findingId: string; decision: Decision }> }) {
  const current = await loadRun(runId);
  assertPermission(user, current.organizationId, "inventory:write", "Découverte introuvable");
  if (current.status !== "REVIEW") {
    throw new ValidationError([{ path: "status", message: "La revue doit précéder l'approbation." }]);
  }
  const expected = new Set(current.findings.map((finding) => finding.id));
  const seen = new Set<string>();
  for (const decision of input.decisions) {
    if (!expected.has(decision.findingId) || seen.has(decision.findingId)) {
      throw new ValidationError([{ path: "decisions", message: "Chaque observation doit être acceptée ou refusée, une seule fois." }]);
    }
    seen.add(decision.findingId);
  }
  if (seen.size !== expected.size) {
    throw new ValidationError([{ path: "decisions", message: "Chaque observation doit être acceptée ou refusée, une seule fois." }]);
  }
  for (const decision of input.decisions) {
    const finding = current.findings.find((item) => item.id === decision.findingId);
    const message = finding ? decisionError(finding.verdict, decision.decision) : null;
    if (message) throw new ValidationError([{ path: "decisions", message }]);
  }
  const run = await prisma.$transaction(async (tx) => {
    for (const decision of input.decisions) {
      await tx.discoveryFinding.update({ where: { id: decision.findingId }, data: { decision: decision.decision } });
    }
    return tx.discoveryRun.update({ where: { id: current.id }, data: { status: "APPROVED" }, include: runInclude });
  });
  await recordAudit({
    actor: user,
    organizationId: current.organizationId,
    action: "discovery.run.approve",
    resourceType: "DiscoveryRun",
    resourceId: current.id,
    metadata: { accepted: input.decisions.filter((item) => item.decision === "ACCEPTED").length },
  });
  return present(run);
}

export async function importDiscoveryRun(user: AuthUser, runId: string, input: { siteId: string; confirmProduction?: boolean }) {
  const current = await loadRun(runId);
  assertPermission(user, current.organizationId, "inventory:write", "Découverte introuvable");
  if (current.status !== "APPROVED") {
    throw new ValidationError([{ path: "status", message: "L'import n'est possible qu'après approbation. Aucun équipement n'est ajouté automatiquement." }]);
  }
  const site = await prisma.site.findFirst({ where: { id: input.siteId, organizationId: current.organizationId } });
  if (!site) throw new NotFoundError("Site introuvable");
  const accepted = current.findings.filter((finding) => finding.decision === "ACCEPTED" && finding.verdict === "DISCOVERED");
  if (site.environment === "PRODUCTION" && accepted.length > 0 && input.confirmProduction !== true) {
    throw new ValidationError([{ path: "confirmProduction", message: "L'import sur un site de production exige une confirmation explicite." }]);
  }
  for (const finding of accepted) {
    if (!finding.hostname || !finding.ipAddress || !finding.role) {
      throw new ValidationError([{ path: "findings", message: "Une observation acceptée n'a pas de nom, d'adresse ou de rôle. Elle n'est pas importée." }]);
    }
  }
  const created: Array<{ id: string; hostname: string }> = [];
  try {
    const run = await prisma.$transaction(async (tx) => {
      for (const finding of accepted) {
        const device = await tx.device.create({
          data: {
            organizationId: current.organizationId,
            siteId: site.id,
            role: finding.role!,
            hostname: finding.hostname!,
            managementIp: finding.ipAddress,
            status: "PLANNED",
            description: finding.simulated
              ? "Issu d'une découverte simulée. Aucun équipement réel n'a été interrogé."
              : "Issu d'une découverte approuvée.",
          },
        });
        created.push({ id: device.id, hostname: device.hostname });
        await tx.discoveryFinding.update({ where: { id: finding.id }, data: { importedDeviceId: device.id } });
      }
      return tx.discoveryRun.update({ where: { id: current.id }, data: { status: "IMPORTED" }, include: runInclude });
    });
    for (const device of created) {
      await recordAudit({
        actor: user,
        organizationId: current.organizationId,
        action: "device.create",
        resourceType: "Device",
        resourceId: device.id,
        metadata: { hostname: device.hostname, status: "PLANNED", discoveryRunId: current.id },
      });
    }
    await recordAudit({
      actor: user,
      organizationId: current.organizationId,
      action: "discovery.run.import",
      resourceType: "DiscoveryRun",
      resourceId: current.id,
      metadata: { siteId: site.id, environment: site.environment, created: accepted.length },
    });
    return present(run);
  } catch (error) {
    rethrowUnique(error, "Cet équipement ou cette adresse existe déjà. L'import est annulé, l'inventaire n'est pas modifié.");
  }
}

export async function deleteDiscoveryRun(user: AuthUser, runId: string) {
  const current = await loadRun(runId);
  assertPermission(user, current.organizationId, "inventory:delete", "Découverte introuvable");
  await recordAudit({ actor: user, organizationId: current.organizationId, action: "discovery.run.delete", resourceType: "DiscoveryRun", resourceId: current.id, metadata: { label: current.label } });
  await prisma.discoveryRun.delete({ where: { id: current.id } });
  return { ok: true };
}

function findingData(finding: ClassifiedObservation, position: number): Prisma.DiscoveryFindingUncheckedCreateWithoutRunInput {
  return {
    position,
    verdict: finding.verdict,
    simulated: true,
    hostname: finding.hostname,
    ipAddress: finding.ipAddress,
    macAddress: finding.macAddress,
    role: finding.role,
    interfaces: finding.interfaces,
    ports: finding.ports,
    vlans: finding.vlans,
    neighbors: finding.neighbors,
    conflictReason: finding.conflictReason,
    matchedDeviceId: finding.matchedDeviceId,
  };
}
