import { Prisma } from "../../../generated/prisma/client";
import { recordAudit } from "../audit";
import type { AuthUser } from "../auth/context";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import { prisma } from "../prisma";
import { assertPermission } from "../rbac/guard";
import {
  DISCOVERY_NOTICE,
  TOPOLOGY_NOTICE,
  inventoryLinks,
  layoutNodes,
  refuseDiscovery,
} from "../topology/evaluate";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function rethrowUnique(error: unknown, message: string): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new ConflictError(message);
  throw error;
}

async function requireOrganization(user: AuthUser, organizationId: string, permission: "inventory:read" | "inventory:write" | "inventory:delete") {
  const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true } });
  if (!organization) throw new NotFoundError("Organisation introuvable");
  assertPermission(user, organizationId, permission, "Organisation introuvable");
}

type EndpointRef = { deviceId?: string; markerId?: string };

export async function topologyOverview(user: AuthUser, organizationId: string, query: { siteId?: string; q?: string }) {
  await requireOrganization(user, organizationId, "inventory:read");
  const siteFilter = query.siteId ? { siteId: query.siteId } : {};
  const [devices, placements, markers, storedLinks, discoveries] = await Promise.all([
    prisma.device.findMany({
      where: { organizationId, ...siteFilter },
      include: {
        interfaces: { select: { name: true }, orderBy: { name: "asc" } },
        switchPorts: {
          include: {
            accessVlan: { select: { id: true, vid: true, name: true } },
            nativeVlan: { select: { id: true, vid: true, name: true } },
            connectedDevice: { select: { id: true, hostname: true, interfaces: { select: { name: true }, orderBy: { name: "asc" } } } },
          },
          orderBy: { name: "asc" },
        },
      },
      orderBy: { hostname: "asc" },
    }),
    prisma.topologyPlacement.findMany({ where: { organizationId } }),
    prisma.topologyMarker.findMany({ where: { organizationId, ...siteFilter }, orderBy: { label: "asc" } }),
    prisma.topologyLink.findMany({
      where: { organizationId },
      include: { vlan: { select: { id: true, vid: true, name: true, siteId: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.topologyDiscovery.findMany({ where: { organizationId }, orderBy: { protocol: "asc" } }),
  ]);
  const saved = new Map<string, { x: number; y: number }>();
  for (const placement of placements) saved.set(placement.deviceId, { x: placement.x, y: placement.y });
  for (const marker of markers) saved.set(marker.id, { x: marker.x, y: marker.y });
  const drafts = [
    ...devices.map((device) => ({ id: device.id, role: device.role, label: device.hostname, kind: "DEVICE" as const, simulated: false, siteId: device.siteId })),
    ...markers.map((marker) => ({ id: marker.id, role: marker.kind, label: marker.label, kind: marker.kind, simulated: true as const, siteId: marker.siteId })),
  ];
  const laidOut = layoutNodes(drafts, saved);
  const term = query.q?.trim().toLowerCase();
  const nodes = term
    ? laidOut.filter((node) => node.label.toLowerCase().includes(term) || node.role.toLowerCase().includes(term))
    : laidOut;
  const visible = new Set(nodes.map((node) => node.id));
  const observed = inventoryLinks(devices.flatMap((device) => device.switchPorts.map((port) => ({
    id: port.id,
    name: port.name,
    status: port.status,
    mode: port.mode,
    speedMbps: port.speedMbps,
    device: { id: device.id, hostname: device.hostname },
    connectedDevice: port.connectedDevice,
    accessVlan: port.accessVlan,
    nativeVlan: port.nativeVlan,
  })))).filter((link) => visible.has(link.sourceId) && visible.has(link.targetId));
  const manual = storedLinks.flatMap((link) => {
    const sourceId = link.sourceDeviceId ?? link.sourceMarkerId;
    const targetId = link.targetDeviceId ?? link.targetMarkerId;
    if (!sourceId || !targetId || !visible.has(sourceId) || !visible.has(targetId)) return [];
    if (query.siteId && link.vlan && link.vlan.siteId !== query.siteId) return [];
    return [{
      id: link.id,
      derived: false as const,
      origin: link.origin,
      simulated: link.origin === "SIMULATION",
      sourceId,
      targetId,
      sourcePort: link.sourcePort,
      targetPort: link.targetPort,
      speedMbps: link.speedMbps,
      status: link.status,
      vlan: link.vlan ? { id: link.vlan.id, vid: link.vlan.vid, name: link.vlan.name } : null,
      trafficBps: link.trafficBps,
    }];
  });
  return {
    mode: "INVENTORY" as const,
    notice: TOPOLOGY_NOTICE,
    discoveryNotice: DISCOVERY_NOTICE,
    organizationId,
    nodes,
    links: [...observed, ...manual],
    discoveries: discoveries.map((item) => ({ id: item.id, protocol: item.protocol, status: item.status, notice: DISCOVERY_NOTICE })),
  };
}

export async function createInternetMarker(user: AuthUser, organizationId: string, input: { siteId: string; x?: number; y?: number }) {
  await requireOrganization(user, organizationId, "inventory:write");
  const site = await prisma.site.findFirst({ where: { id: input.siteId, organizationId }, select: { id: true } });
  if (!site) throw new NotFoundError("Site introuvable");
  try {
    const marker = await prisma.topologyMarker.create({
      data: {
        organizationId,
        siteId: site.id,
        kind: "INTERNET",
        label: "Internet",
        simulated: true,
        x: input.x ?? 80,
        y: input.y ?? 160,
      },
    });
    await recordAudit({ actor: user, organizationId, action: "topology.marker.create", resourceType: "TopologyMarker", resourceId: marker.id, metadata: { label: marker.label, simulated: true } });
    return { ...marker, simulated: true as const, notice: TOPOLOGY_NOTICE };
  } catch (error) {
    rethrowUnique(error, "Ce site a déjà un nœud Internet simulé");
  }
}

export async function moveMarker(user: AuthUser, markerId: string, input: { x: number; y: number }) {
  const current = await prisma.topologyMarker.findUnique({ where: { id: markerId } });
  if (!current) throw new NotFoundError("Nœud de topologie introuvable");
  assertPermission(user, current.organizationId, "inventory:write", "Nœud de topologie introuvable");
  if (!current.simulated) throw new ConflictError("Seul un nœud simulé peut être déplacé par ce chemin.");
  const marker = await prisma.topologyMarker.update({ where: { id: current.id }, data: { x: input.x, y: input.y } });
  return { ...marker, notice: TOPOLOGY_NOTICE };
}

export async function deleteMarker(user: AuthUser, markerId: string) {
  const current = await prisma.topologyMarker.findUnique({ where: { id: markerId } });
  if (!current) throw new NotFoundError("Nœud de topologie introuvable");
  assertPermission(user, current.organizationId, "inventory:delete", "Nœud de topologie introuvable");
  if (!current.simulated) throw new ConflictError("Un équipement d'inventaire ne se retire pas de la topologie.");
  await prisma.topologyLink.deleteMany({ where: { OR: [{ sourceMarkerId: current.id }, { targetMarkerId: current.id }] } });
  await recordAudit({ actor: user, organizationId: current.organizationId, action: "topology.marker.delete", resourceType: "TopologyMarker", resourceId: current.id, metadata: { label: current.label, simulated: true } });
  await prisma.topologyMarker.delete({ where: { id: current.id } });
  return { ok: true };
}

export async function savePlacement(user: AuthUser, organizationId: string, input: { deviceId: string; x: number; y: number }) {
  await requireOrganization(user, organizationId, "inventory:write");
  const device = await prisma.device.findFirst({ where: { id: input.deviceId, organizationId }, select: { id: true, hostname: true } });
  if (!device) throw new NotFoundError("Équipement introuvable");
  const placement = await prisma.topologyPlacement.upsert({
    where: { deviceId: device.id },
    update: { x: input.x, y: input.y },
    create: { organizationId, deviceId: device.id, x: input.x, y: input.y },
  });
  return { ...placement, hostname: device.hostname, simulated: false as const, notice: TOPOLOGY_NOTICE };
}

export async function createTopologyLink(
  user: AuthUser,
  organizationId: string,
  input: EndpointRef & { sourceDeviceId?: string; sourceMarkerId?: string; targetDeviceId?: string; targetMarkerId?: string; sourcePort?: string; targetPort?: string; speedMbps?: number | null; status?: "UP" | "DOWN" | "ADMIN_DOWN" | "UNKNOWN"; vlanId?: string; trafficBps?: number | null },
) {
  await requireOrganization(user, organizationId, "inventory:write");
  const source = await resolveEndpoint(organizationId, input.sourceDeviceId, input.sourceMarkerId, "source");
  const target = await resolveEndpoint(organizationId, input.targetDeviceId, input.targetMarkerId, "target");
  if (source.id === target.id) throw new ValidationError([{ path: "target", message: "Un lien relie deux nœuds distincts" }]);
  let vlanId: string | null = null;
  if (input.vlanId) {
    const vlan = await prisma.vlan.findUnique({ where: { id: input.vlanId }, include: { site: { select: { organizationId: true } } } });
    if (!vlan || vlan.site.organizationId !== organizationId) throw new NotFoundError("VLAN introuvable");
    const sites = new Set([source.siteId, target.siteId]);
    if (!sites.has(vlan.siteId)) throw new ValidationError([{ path: "vlanId", message: "Le VLAN doit appartenir au site d'une extrémité" }]);
    vlanId = vlan.id;
  }
  const origin = source.simulated || target.simulated ? "SIMULATION" : "MANUAL";
  const sourcePort = input.sourcePort?.trim() || null;
  const targetPort = input.targetPort?.trim() || null;
  const duplicate = await prisma.topologyLink.findFirst({
    where: {
      organizationId,
      sourceDeviceId: source.deviceId,
      sourceMarkerId: source.markerId,
      targetDeviceId: target.deviceId,
      targetMarkerId: target.markerId,
      sourcePort,
      targetPort,
    },
  });
  if (duplicate) throw new ConflictError("Ce lien existe déjà");
  const link = await prisma.topologyLink.create({
    data: {
      organizationId,
      sourceDeviceId: source.deviceId,
      sourceMarkerId: source.markerId,
      targetDeviceId: target.deviceId,
      targetMarkerId: target.markerId,
      sourcePort,
      targetPort,
      speedMbps: input.speedMbps ?? null,
      status: input.status ?? "UNKNOWN",
      vlanId,
      trafficBps: input.trafficBps ?? null,
      origin,
    },
  });
  await recordAudit({ actor: user, organizationId, action: "topology.link.create", resourceType: "TopologyLink", resourceId: link.id, metadata: { origin, simulated: origin === "SIMULATION" } });
  return { ...link, simulated: origin === "SIMULATION", notice: TOPOLOGY_NOTICE };
}

export async function deleteTopologyLink(user: AuthUser, linkId: string) {
  if (linkId.startsWith("inventory:")) throw new ConflictError("Ce lien vient de l'inventaire. Retirez le raccordement du port pour le supprimer.");
  if (!UUID.test(linkId)) throw new NotFoundError("Lien introuvable");
  const current = await prisma.topologyLink.findUnique({ where: { id: linkId } });
  if (!current) throw new NotFoundError("Lien introuvable");
  assertPermission(user, current.organizationId, "inventory:delete", "Lien introuvable");
  await recordAudit({ actor: user, organizationId: current.organizationId, action: "topology.link.delete", resourceType: "TopologyLink", resourceId: current.id, metadata: { origin: current.origin } });
  await prisma.topologyLink.delete({ where: { id: current.id } });
  return { ok: true };
}

export async function generateDiscovery(user: AuthUser, discoveryId: string) {
  if (!UUID.test(discoveryId)) throw new NotFoundError("Découverte introuvable");
  const current = await prisma.topologyDiscovery.findUnique({ where: { id: discoveryId } });
  if (!current) throw new NotFoundError("Découverte introuvable");
  assertPermission(user, current.organizationId, "inventory:write", "Découverte introuvable");
  const refused = refuseDiscovery();
  throw new ValidationError([{ path: "protocol", message: refused.message }]);
}

async function resolveEndpoint(organizationId: string, deviceId: string | undefined, markerId: string | undefined, path: string) {
  if (Boolean(deviceId) === Boolean(markerId)) {
    throw new ValidationError([{ path, message: "Choisissez un équipement de l'inventaire ou le nœud Internet" }]);
  }
  if (deviceId) {
    const device = await prisma.device.findFirst({ where: { id: deviceId, organizationId }, select: { id: true, siteId: true } });
    if (!device) throw new NotFoundError("Équipement introuvable");
    return { id: device.id, deviceId: device.id, markerId: null as string | null, siteId: device.siteId, simulated: false };
  }
  const marker = await prisma.topologyMarker.findFirst({ where: { id: markerId, organizationId }, select: { id: true, siteId: true, simulated: true } });
  if (!marker || !marker.simulated) throw new NotFoundError("Nœud de topologie introuvable");
  return { id: marker.id, deviceId: null as string | null, markerId: marker.id, siteId: marker.siteId, simulated: true };
}
