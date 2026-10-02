import { Prisma } from "../../../generated/prisma/client";
import { recordAudit } from "../audit";
import type { AuthUser } from "../auth/context";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import { isUsable, parseAddress, parsePrefix } from "../ipam/address";
import { prisma } from "../prisma";
import { assertPermission } from "../rbac/guard";
import {
  OSPF_NOTICE,
  ROUTING_NOTICE,
  connectedPrefix,
  interVlanPaths,
  networkIssue,
  prepareRoute,
  storedRouteIssues,
  type RouteProtocol,
} from "../routing/evaluate";
import { blankToNull } from "../validation/network";

const interfaceInclude = {
  device: { select: { id: true, hostname: true, siteId: true, organizationId: true } },
  vlan: { select: { id: true, vid: true, name: true } },
  subnet: { select: { id: true, cidr: true, name: true, vlanId: true, network: { select: { siteId: true, organizationId: true } } } },
  parentInterface: { select: { id: true, name: true, ipAddress: true } },
} as const;

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

async function planCidrs(organizationId: string) {
  const [networks, subnets] = await Promise.all([
    prisma.ipNetwork.findMany({ where: { organizationId }, select: { cidr: true } }),
    prisma.ipSubnet.findMany({ where: { network: { organizationId } }, select: { cidr: true } }),
  ]);
  return [...networks, ...subnets].map((item) => item.cidr);
}

function mapConnected(item: {
  id: string;
  name: string;
  kind: string;
  address: string;
  status: string;
  subnet: { cidr: string };
  device: { id: string; hostname: string };
}) {
  const prefix = connectedPrefix(item.address, item.subnet.cidr);
  if (!prefix.ok) return null;
  return {
    id: `connected:${item.id}`,
    derived: true,
    destination: prefix.destination,
    prefix: prefix.prefix,
    cidr: prefix.cidr,
    gateway: null as string | null,
    interface: { id: item.id, name: item.name, kind: item.kind },
    metric: 0,
    protocol: "CONNECTED" as RouteProtocol,
    device: item.device,
    status: item.status,
    issues: [] as { code: string; message: string }[],
  };
}

export async function routingOverview(user: AuthUser, organizationId: string, query: { siteId?: string }) {
  await requireOrganization(user, organizationId, "inventory:read");
  const [interfaces, routes, processes, plan] = await Promise.all([
    prisma.layer3Interface.findMany({
      where: { device: { organizationId, siteId: query.siteId } },
      include: interfaceInclude,
      orderBy: { name: "asc" },
    }),
    prisma.route.findMany({
      where: { device: { organizationId, siteId: query.siteId } },
      include: { device: { select: { id: true, hostname: true } }, layer3Interface: { select: { id: true, name: true, kind: true, subnet: { select: { cidr: true } } } } },
      orderBy: { cidr: "asc" },
    }),
    prisma.ospfProcess.findMany({
      where: { device: { organizationId, siteId: query.siteId } },
      include: { device: { select: { id: true, hostname: true } }, areas: { include: { interfaces: { select: { id: true, name: true } } } } },
    }),
    planCidrs(organizationId),
  ]);
  const connected = interfaces.flatMap((item) => {
    const route = mapConnected(item);
    return route ? [route] : [];
  });
  const linksByDevice = new Map<string, { cidr: string; address: string; interfaceId: string; name: string }[]>();
  for (const item of interfaces) {
    const list = linksByDevice.get(item.device.id) ?? [];
    list.push({ cidr: item.subnet.cidr, address: item.address, interfaceId: item.id, name: item.name });
    linksByDevice.set(item.device.id, list);
  }
  const stored = routes.map((route) => ({
    id: route.id,
    derived: false,
    destination: route.destination,
    prefix: route.prefixLength,
    cidr: route.cidr,
    gateway: route.gateway,
    interface: route.layer3Interface ? { id: route.layer3Interface.id, name: route.layer3Interface.name, kind: route.layer3Interface.kind } : null,
    metric: route.metric,
    protocol: route.protocol,
    device: route.device,
    status: route.status,
    issues: storedRouteIssues(route.cidr, route.gateway, linksByDevice.get(route.device.id) ?? [], plan),
  }));
  const paths = interVlanPaths(interfaces.flatMap((item) => (item.vlan ? [{ vlan: item.vlan, address: item.address, name: item.name, kind: item.kind, device: { id: item.device.id, hostname: item.device.hostname } }] : [])));
  const devices = [...new Map(interfaces.map((item) => [item.device.id, item.device])).values()];
  return {
    mode: "PLANNED" as const,
    notice: ROUTING_NOTICE,
    ospfNotice: OSPF_NOTICE,
    organizationId,
    totals: { interfaces: interfaces.length, routes: connected.length + stored.length, paths: paths.length, alerts: stored.reduce((sum, route) => sum + route.issues.length, 0) },
    paths: paths.map((path) => ({
      fromVlan: path.from.vlan,
      gateway: path.from.address,
      fromInterface: { name: path.from.name, kind: path.from.kind },
      router: path.router,
      toVlan: path.to.vlan,
      toGateway: path.to.address,
      toInterface: { name: path.to.name, kind: path.to.kind },
    })),
    devices: devices.map((device) => ({
      ...device,
      routes: connected.filter((route) => route.device.id === device.id).length + stored.filter((route) => route.device.id === device.id).length,
    })),
    interfaces: interfaces.map((item) => ({ id: item.id, name: item.name, kind: item.kind, address: item.address, status: item.status, device: item.device, vlan: item.vlan, subnet: { id: item.subnet.id, cidr: item.subnet.cidr }, parent: item.parentInterface })),
    routes: [...connected, ...stored],
    ospf: processes.map((process) => ({
      id: process.id,
      processId: process.processId,
      routerId: process.routerId,
      status: process.status,
      device: process.device,
      areas: process.areas.map((area) => ({ id: area.id, areaId: area.areaId, interfaces: area.interfaces })),
      notice: OSPF_NOTICE,
    })),
  };
}

export async function deviceRoutingTable(user: AuthUser, deviceId: string) {
  const device = await prisma.device.findUnique({
    where: { id: deviceId },
    include: {
      site: { select: { id: true, name: true, organizationId: true } },
      layer3Interfaces: { include: interfaceInclude },
      routes: { include: { layer3Interface: { select: { id: true, name: true, kind: true } } }, orderBy: { cidr: "asc" } },
      ospfProcess: { include: { areas: { include: { interfaces: { select: { id: true, name: true } } } } } },
    },
  });
  if (!device) throw new NotFoundError("Équipement introuvable");
  assertPermission(user, device.site.organizationId, "inventory:read", "Équipement introuvable");
  const plan = await planCidrs(device.organizationId);
  const connected = device.layer3Interfaces.flatMap((item) => {
    const route = mapConnected({ ...item, device: { id: device.id, hostname: device.hostname } });
    return route ? [route] : [];
  });
  const links = device.layer3Interfaces.map((item) => ({ cidr: item.subnet.cidr, address: item.address, interfaceId: item.id, name: item.name }));
  const stored = device.routes.map((route) => ({
    id: route.id,
    derived: false,
    destination: route.destination,
    prefix: route.prefixLength,
    cidr: route.cidr,
    gateway: route.gateway,
    interface: route.layer3Interface,
    metric: route.metric,
    protocol: route.protocol,
    device: { id: device.id, hostname: device.hostname },
    status: route.status,
    issues: storedRouteIssues(route.cidr, route.gateway, links, plan),
  }));
  const routes = [...connected, ...stored].sort((left, right) => protocolRank(left.protocol) - protocolRank(right.protocol) || right.prefix - left.prefix);
  return {
    mode: "PLANNED" as const,
    notice: ROUTING_NOTICE,
    ospfNotice: OSPF_NOTICE,
    organizationId: device.organizationId,
    device: { id: device.id, hostname: device.hostname, site: device.site },
    interfaces: device.layer3Interfaces.map((item) => ({ id: item.id, name: item.name, kind: item.kind, address: item.address, vlan: item.vlan, subnet: { cidr: item.subnet.cidr } })),
    routes,
    ospf: device.ospfProcess
      ? { id: device.ospfProcess.id, processId: device.ospfProcess.processId, routerId: device.ospfProcess.routerId, status: device.ospfProcess.status, areas: device.ospfProcess.areas, notice: OSPF_NOTICE }
      : null,
  };
}

function protocolRank(protocol: string) {
  if (protocol === "CONNECTED") return 0;
  if (protocol === "STATIC") return 1;
  if (protocol === "DEFAULT") return 2;
  return 3;
}

export async function createLayer3Interface(
  user: AuthUser,
  organizationId: string,
  input: { deviceId: string; name: string; kind: "PHYSICAL" | "SVI" | "SUBINTERFACE"; vlanId?: string; parentInterfaceId?: string; address: string; subnetId: string; status?: "PLANNED" | "ACTIVE" | "DISABLED"; description?: string | null },
) {
  await requireOrganization(user, organizationId, "inventory:write");
  const device = await prisma.device.findFirst({ where: { id: input.deviceId, organizationId }, select: { id: true, hostname: true, siteId: true } });
  if (!device) throw new NotFoundError("Équipement introuvable");
  const subnet = await prisma.ipSubnet.findUnique({ where: { id: input.subnetId }, include: { vlan: { select: { id: true, siteId: true } }, network: { select: { organizationId: true, siteId: true } } } });
  if (!subnet || subnet.network.organizationId !== organizationId) throw new NotFoundError("Sous-réseau introuvable");
  if (subnet.network.siteId !== device.siteId) throw new ValidationError([{ path: "subnetId", message: "Le sous-réseau doit appartenir au site de l'équipement" }]);
  const address = canonicalAddress(input.address, "address");
  const usable = connectedPrefix(address, subnet.cidr);
  if (!usable.ok) throw new ValidationError([{ path: "address", message: usable.message }]);
  let vlanId = input.vlanId ?? subnet.vlan.id;
  if (input.vlanId && input.vlanId !== subnet.vlan.id) throw new ValidationError([{ path: "vlanId", message: "Le VLAN doit être celui du sous-réseau" }]);
  if (subnet.vlan.siteId !== device.siteId) throw new ValidationError([{ path: "vlanId", message: "Le VLAN doit appartenir au site de l'équipement" }]);
  if (input.kind === "SVI" && input.parentInterfaceId) throw new ValidationError([{ path: "parentInterfaceId", message: "Une SVI n'a pas d'interface physique parente" }]);
  if (input.kind !== "SVI" && !input.parentInterfaceId) throw new ValidationError([{ path: "parentInterfaceId", message: "L'interface physique parente est obligatoire" }]);
  if (input.kind === "SVI") vlanId = subnet.vlan.id;
  let parentInterfaceId: string | null = null;
  if (input.parentInterfaceId) {
    const parent = await prisma.networkInterface.findUnique({ where: { id: input.parentInterfaceId }, select: { id: true, deviceId: true, ipAddress: true } });
    if (!parent || parent.deviceId !== device.id) throw new NotFoundError("Interface parente introuvable");
    if (input.kind === "PHYSICAL" && parent.ipAddress && parent.ipAddress !== address) {
      throw new ValidationError([{ path: "address", message: "L'adresse doit être celle déjà portée par l'interface d'inventaire" }]);
    }
    parentInterfaceId = parent.id;
  }
  const duplicateSubnet = await prisma.layer3Interface.findFirst({ where: { deviceId: device.id, subnetId: subnet.id }, select: { name: true } });
  if (duplicateSubnet) throw new ConflictError(`Le sous-réseau est déjà connecté sur ${duplicateSubnet.name}`);
  try {
    const created = await prisma.layer3Interface.create({
      data: {
        deviceId: device.id,
        name: input.name.trim(),
        kind: input.kind,
        vlanId,
        parentInterfaceId,
        address,
        subnetId: subnet.id,
        status: input.status ?? "PLANNED",
        description: blankToNull(input.description) ?? null,
      },
    });
    await recordAudit({ actor: user, organizationId, action: "layer3.create", resourceType: "Layer3Interface", resourceId: created.id, metadata: { device: device.hostname, name: created.name, kind: created.kind, address, cidr: subnet.cidr, mode: "PLANNED" } });
    return { ...created, mode: "PLANNED" as const, notice: ROUTING_NOTICE };
  } catch (error) {
    rethrowUnique(error, "Cette interface de routage existe déjà sur l'équipement");
  }
}

export async function deleteLayer3Interface(user: AuthUser, interfaceId: string) {
  const current = await prisma.layer3Interface.findUnique({ where: { id: interfaceId }, include: { device: { select: { hostname: true, organizationId: true } }, _count: { select: { routes: true } } } });
  if (!current) throw new NotFoundError("Interface de routage introuvable");
  assertPermission(user, current.device.organizationId, "inventory:delete", "Interface de routage introuvable");
  if (current._count.routes > 0) throw new ConflictError("Des routes statiques utilisent cette interface. Retirez-les d'abord.");
  await recordAudit({ actor: user, organizationId: current.device.organizationId, action: "layer3.delete", resourceType: "Layer3Interface", resourceId: current.id, metadata: { device: current.device.hostname, name: current.name } });
  await prisma.layer3Interface.delete({ where: { id: current.id } });
  return { ok: true };
}

export async function createRoute(
  user: AuthUser,
  organizationId: string,
  input: { deviceId: string; protocol: "STATIC" | "DEFAULT" | "OSPF"; cidr: string; gateway: string; layer3InterfaceId?: string; metric?: number; description?: string | null },
) {
  await requireOrganization(user, organizationId, "inventory:write");
  const device = await prisma.device.findFirst({
    where: { id: input.deviceId, organizationId },
    include: { layer3Interfaces: { include: { subnet: { select: { cidr: true } } } }, routes: { select: { cidr: true } } },
  });
  if (!device) throw new NotFoundError("Équipement introuvable");
  const connected = device.layer3Interfaces.map((item) => ({ cidr: item.subnet.cidr, address: item.address, interfaceId: item.id, name: item.name }));
  const prepared = prepareRoute(input, connected, [...device.routes.map((route) => route.cidr), ...connected.map((item) => item.cidr)]);
  if (!prepared.ok) {
    if (prepared.status === 409) throw new ConflictError(prepared.message);
    throw new ValidationError([{ path: "cidr", message: prepared.message }]);
  }
  let layer3InterfaceId: string | null = null;
  if (input.layer3InterfaceId) {
    const selected = device.layer3Interfaces.find((item) => item.id === input.layer3InterfaceId);
    if (!selected) throw new NotFoundError("Interface de routage introuvable");
    const gateway = parseAddress(prepared.gateway);
    const prefix = parsePrefix(selected.subnet.cidr);
    if (!gateway || !prefix.ok || !isUsable(prefix.prefix, gateway)) {
      throw new ValidationError([{ path: "layer3InterfaceId", message: "La passerelle n'appartient pas au réseau connecté de cette interface" }]);
    }
    layer3InterfaceId = selected.id;
  }
  const plan = await planCidrs(organizationId);
  const issue = networkIssue(prepared.cidr, plan);
  try {
    const route = await prisma.route.create({
      data: {
        deviceId: device.id,
        destination: prepared.destination,
        prefixLength: prepared.prefix,
        cidr: prepared.cidr,
        gateway: prepared.gateway,
        layer3InterfaceId,
        metric: prepared.metric,
        protocol: prepared.protocol,
        description: blankToNull(input.description) ?? null,
      },
    });
    await recordAudit({ actor: user, organizationId, action: "route.create", resourceType: "Route", resourceId: route.id, metadata: { device: device.hostname, cidr: route.cidr, gateway: route.gateway, protocol: route.protocol, mode: "PLANNED" } });
    return { ...route, mode: "PLANNED" as const, notice: ROUTING_NOTICE, issues: issue ? [issue] : [] };
  } catch (error) {
    rethrowUnique(error, "Cette destination existe déjà dans la table de routage");
  }
}

export async function deleteRoute(user: AuthUser, routeId: string) {
  const current = await prisma.route.findUnique({ where: { id: routeId }, include: { device: { select: { hostname: true, organizationId: true } } } });
  if (!current) throw new NotFoundError("Route introuvable");
  assertPermission(user, current.device.organizationId, "inventory:delete", "Route introuvable");
  if (current.protocol === "CONNECTED") throw new ConflictError("Une route connectée se retire avec son interface.");
  await recordAudit({ actor: user, organizationId: current.device.organizationId, action: "route.delete", resourceType: "Route", resourceId: current.id, metadata: { device: current.device.hostname, cidr: current.cidr } });
  await prisma.route.delete({ where: { id: current.id } });
  return { ok: true };
}

export async function createOspfProcess(
  user: AuthUser,
  organizationId: string,
  input: { deviceId: string; processId: number; routerId: string; areaId?: string; interfaceIds?: string[]; description?: string | null },
) {
  await requireOrganization(user, organizationId, "inventory:write");
  const device = await prisma.device.findFirst({ where: { id: input.deviceId, organizationId }, select: { id: true, hostname: true, ospfProcess: { select: { id: true } } } });
  if (!device) throw new NotFoundError("Équipement introuvable");
  if (device.ospfProcess) throw new ConflictError("Cet équipement a déjà un processus OSPF");
  const routerId = parseAddress(input.routerId);
  if (!routerId || routerId.family !== "IPV4") throw new ValidationError([{ path: "routerId", message: "Le router-id OSPF doit être une IPv4" }]);
  const areaId = normalizeArea(input.areaId ?? "0.0.0.0");
  const interfaceIds = input.interfaceIds ?? [];
  if (interfaceIds.length) {
    const found = await prisma.layer3Interface.count({ where: { id: { in: interfaceIds }, deviceId: device.id } });
    if (found !== interfaceIds.length) throw new NotFoundError("Interface de routage introuvable");
  }
  const process = await prisma.ospfProcess.create({
    data: {
      deviceId: device.id,
      processId: input.processId,
      routerId: routerId.text,
      status: "PLANNED",
      description: blankToNull(input.description) ?? null,
      areas: { create: { areaId, ...(interfaceIds.length ? { interfaces: { connect: interfaceIds.map((id) => ({ id })) } } : {}) } },
    },
    include: { areas: { include: { interfaces: { select: { id: true, name: true } } } } },
  });
  await recordAudit({ actor: user, organizationId, action: "ospf.create", resourceType: "OspfProcess", resourceId: process.id, metadata: { device: device.hostname, processId: process.processId, routerId: process.routerId, mode: "PLANNED" } });
  return { ...process, mode: "PLANNED" as const, notice: OSPF_NOTICE };
}

export async function deleteOspfProcess(user: AuthUser, processId: string) {
  const current = await prisma.ospfProcess.findUnique({ where: { id: processId }, include: { device: { select: { hostname: true, organizationId: true } } } });
  if (!current) throw new NotFoundError("Processus OSPF introuvable");
  assertPermission(user, current.device.organizationId, "inventory:delete", "Processus OSPF introuvable");
  await recordAudit({ actor: user, organizationId: current.device.organizationId, action: "ospf.delete", resourceType: "OspfProcess", resourceId: current.id, metadata: { device: current.device.hostname, processId: current.processId } });
  await prisma.ospfProcess.delete({ where: { id: current.id } });
  return { ok: true };
}

function normalizeArea(value: string) {
  if (/^\d+$/.test(value) && Number(value) <= 255) return `0.0.0.${Number(value)}`;
  const parsed = parseAddress(value);
  if (!parsed || parsed.family !== "IPV4") throw new ValidationError([{ path: "areaId", message: "L'aire OSPF doit être un identifiant IPv4, par exemple 0.0.0.0" }]);
  return parsed.text;
}
