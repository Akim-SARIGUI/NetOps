import type { AuthUser } from "../auth/context";
import { recordAudit } from "../audit";
import {
  DOCUMENTATION_NOTICE,
  SECTION_META,
  SECTIONS,
  moduleRelations,
  toCsv,
  toJsonDocument,
  toPdf,
  type DocSection,
  type DocRow,
  type ExportFormat,
  type SectionId,
} from "../documentation/evaluate";
import { NotFoundError } from "../errors";
import { prisma } from "../prisma";
import { assertPermission } from "../rbac/guard";

async function requireOrganization(user: AuthUser, organizationId: string) {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, name: true, slug: true },
  });
  if (!organization) throw new NotFoundError("Organisation introuvable");
  assertPermission(user, organizationId, "inventory:read", "Organisation introuvable");
  return organization;
}

async function resolveSite(organizationId: string, siteId: string | undefined) {
  if (!siteId) return null;
  const site = await prisma.site.findFirst({
    where: { id: siteId, organizationId },
    select: { id: true, name: true, code: true, environment: true },
  });
  if (!site) throw new NotFoundError("Site introuvable");
  return site;
}

export async function documentationOverview(user: AuthUser, organizationId: string, query: { siteId?: string }) {
  const organization = await requireOrganization(user, organizationId);
  const site = await resolveSite(organizationId, query.siteId);
  const document = await buildDocument(organization, site?.id ?? null);
  return {
    notice: DOCUMENTATION_NOTICE,
    generatedAt: document.generatedAt,
    organization: { id: organization.id, name: organization.name, slug: organization.slug },
    site,
    formats: ["JSON", "CSV", "PDF"],
    relations: document.relations,
    sections: document.sections.map((section) => ({
      id: section.id,
      title: section.title,
      description: section.description,
      rowCount: section.rows.length,
      columns: section.columns,
      preview: section.rows.slice(0, 8),
    })),
  };
}

export async function exportDocumentation(
  user: AuthUser,
  organizationId: string,
  query: { siteId?: string; format: ExportFormat },
) {
  const organization = await requireOrganization(user, organizationId);
  const site = await resolveSite(organizationId, query.siteId);
  const document = await buildDocument(organization, site?.id ?? null);
  const stamp = document.generatedAt.slice(0, 10);
  const base = `netops-documentation-${organization.slug}${site ? `-${site.code}` : ""}-${stamp}`;

  let filename = `${base}.json`;
  let mediaType = "application/json";
  let content = toJsonDocument({
    notice: DOCUMENTATION_NOTICE,
    organization: { id: organization.id, name: organization.name, slug: organization.slug },
    generatedAt: document.generatedAt,
    siteId: site?.id ?? null,
    sections: document.sections,
    relations: document.relations,
  });
  let encoding: "utf8" | "base64" = "utf8";

  if (query.format === "CSV") {
    filename = `${base}.csv`;
    mediaType = "text/csv; charset=utf-8";
    content = toCsv(document.sections);
  } else if (query.format === "PDF") {
    filename = `${base}.pdf`;
    mediaType = "application/pdf";
    content = toPdf({
      title: "NetOps Infrastructure Documentation",
      notice: DOCUMENTATION_NOTICE,
      generatedAt: document.generatedAt,
      organizationName: organization.name,
      sections: document.sections,
    }).toString("base64");
    encoding = "base64";
  }

  await recordAudit({
    actor: user,
    organizationId,
    action: "documentation.export",
    resourceType: "Documentation",
    resourceId: organizationId,
    metadata: { format: query.format, siteId: site?.id ?? null, sections: document.sections.length },
  });

  return {
    notice: DOCUMENTATION_NOTICE,
    format: query.format,
    filename,
    mediaType,
    encoding,
    content,
    generatedAt: document.generatedAt,
  };
}

async function buildDocument(
  organization: { id: string; name: string; slug: string },
  siteId: string | null,
) {
  const siteFilter = siteId ? { siteId } : {};
  const [
    sites,
    devices,
    interfaces,
    vlans,
    networks,
    subnets,
    addresses,
    ports,
    dhcpServers,
    dhcpScopes,
    dnsServers,
    dnsZones,
    dnsRecords,
    layer3,
    routes,
    zones,
    flows,
    links,
    markers,
    changeVersions,
    changeRequests,
  ] = await Promise.all([
    prisma.site.findMany({
      where: { organizationId: organization.id, ...(siteId ? { id: siteId } : {}) },
      select: { code: true, name: true, environment: true, address: true },
      orderBy: { name: "asc" },
    }),
    prisma.device.findMany({
      where: { organizationId: organization.id, ...siteFilter },
      select: { hostname: true, role: true, status: true, managementIp: true, vendor: true, model: true, site: { select: { code: true } } },
      orderBy: { hostname: "asc" },
    }),
    prisma.networkInterface.findMany({
      where: { device: { organizationId: organization.id, ...siteFilter } },
      select: { name: true, ipAddress: true, macAddress: true, status: true, device: { select: { hostname: true } } },
      orderBy: [{ device: { hostname: "asc" } }, { name: "asc" }],
    }),
    prisma.vlan.findMany({
      where: { site: { organizationId: organization.id, ...(siteId ? { id: siteId } : {}) } },
      select: { vid: true, name: true, role: true, securityZone: true, status: true, site: { select: { code: true } }, subnets: { select: { cidr: true } } },
      orderBy: [{ site: { code: "asc" } }, { vid: "asc" }],
    }),
    prisma.ipNetwork.findMany({
      where: { organizationId: organization.id, ...siteFilter },
      select: { name: true, cidr: true, family: true, site: { select: { code: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.ipSubnet.findMany({
      where: { network: { organizationId: organization.id, ...siteFilter } },
      select: {
        name: true,
        cidr: true,
        vlan: { select: { vid: true, name: true } },
        gatewayAddress: { select: { address: true } },
        network: { select: { name: true, site: { select: { code: true } } } },
      },
      orderBy: { cidr: "asc" },
    }),
    prisma.ipAddress.findMany({
      where: { organizationId: organization.id, ...(siteId ? { subnet: { network: { siteId } } } : {}) },
      select: { address: true, role: true, subnet: { select: { cidr: true } }, interface: { select: { name: true, device: { select: { hostname: true } } } } },
      orderBy: { address: "asc" },
      take: 500,
    }),
    prisma.switchPort.findMany({
      where: { device: { organizationId: organization.id, ...siteFilter } },
      select: {
        name: true,
        mode: true,
        status: true,
        device: { select: { hostname: true } },
        accessVlan: { select: { vid: true } },
        nativeVlan: { select: { vid: true } },
        allowedVlans: { select: { vlan: { select: { vid: true } } } },
        connectedDevice: { select: { hostname: true } },
      },
      orderBy: [{ device: { hostname: "asc" } }, { name: "asc" }],
    }),
    prisma.dhcpServer.findMany({
      where: { organizationId: organization.id, ...siteFilter },
      select: { name: true, status: true, address: true, site: { select: { code: true } }, device: { select: { hostname: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.dhcpScope.findMany({
      where: { subnet: { network: { organizationId: organization.id, ...siteFilter } } },
      select: {
        enabled: true,
        gateway: true,
        server: { select: { name: true } },
        subnet: { select: { cidr: true, vlan: { select: { vid: true } } } },
        pools: { select: { startAddress: true, endAddress: true } },
      },
      orderBy: { subnet: { cidr: "asc" } },
    }),
    prisma.dnsServer.findMany({
      where: { organizationId: organization.id, ...siteFilter },
      select: { name: true, status: true, address: true, site: { select: { code: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.dnsZone.findMany({
      where: { organizationId: organization.id, ...(siteId ? { server: { siteId } } : {}) },
      select: { name: true, kind: true, enabled: true, server: { select: { name: true } }, subnet: { select: { cidr: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.dnsRecord.findMany({
      where: { zone: { organizationId: organization.id, ...(siteId ? { server: { siteId } } : {}) } },
      select: { name: true, type: true, rdata: true, zone: { select: { name: true } } },
      orderBy: [{ zone: { name: "asc" } }, { name: "asc" }],
      take: 500,
    }),
    prisma.layer3Interface.findMany({
      where: { device: { organizationId: organization.id, ...siteFilter } },
      select: { name: true, kind: true, address: true, status: true, device: { select: { hostname: true } }, vlan: { select: { vid: true } }, subnet: { select: { cidr: true } } },
      orderBy: [{ device: { hostname: "asc" } }, { name: "asc" }],
    }),
    prisma.route.findMany({
      where: { device: { organizationId: organization.id, ...siteFilter } },
      select: { cidr: true, gateway: true, protocol: true, status: true, metric: true, device: { select: { hostname: true } } },
      orderBy: [{ device: { hostname: "asc" } }, { cidr: "asc" }],
    }),
    prisma.firewallZone.findMany({
      where: { organizationId: organization.id },
      select: { name: true, description: true, vlans: { select: { vlan: { select: { vid: true, site: { select: { code: true } } } } } } },
      orderBy: { name: "asc" },
    }),
    prisma.flowRule.findMany({
      where: { organizationId: organization.id },
      select: { priority: true, action: true, protocol: true, source: true, destination: true, enabled: true },
      orderBy: { priority: "asc" },
    }),
    prisma.topologyLink.findMany({
      where: { organizationId: organization.id, ...(siteId ? { OR: [{ sourceDevice: { siteId } }, { targetDevice: { siteId } }] } : {}) },
      select: {
        origin: true,
        status: true,
        sourcePort: true,
        targetPort: true,
        sourceDevice: { select: { hostname: true } },
        targetDevice: { select: { hostname: true } },
        sourceMarker: { select: { label: true } },
        targetMarker: { select: { label: true } },
        vlan: { select: { vid: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.topologyMarker.findMany({
      where: { organizationId: organization.id, ...siteFilter },
      select: { label: true, kind: true, site: { select: { code: true } } },
      orderBy: { label: "asc" },
    }),
    prisma.configVersion.findMany({
      where: { organizationId: organization.id, ...(siteId ? { device: { siteId } } : {}) },
      select: { number: true, origin: true, simulated: true, createdAt: true, device: { select: { hostname: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.changeRequest.findMany({
      where: { organizationId: organization.id, ...(siteId ? { device: { siteId } } : {}) },
      select: { title: true, phase: true, integration: true, device: { select: { hostname: true } }, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);

  const sections: DocSection[] = SECTIONS.map((id) => {
    const meta = SECTION_META[id];
    const built = buildSection(id, {
      sites,
      devices,
      interfaces,
      vlans,
      networks,
      subnets,
      addresses,
      ports,
      dhcpServers,
      dhcpScopes,
      dnsServers,
      dnsZones,
      dnsRecords,
      layer3,
      routes,
      zones,
      flows,
      links,
      markers,
      changeVersions,
      changeRequests,
    });
    return { id, title: meta.title, description: meta.description, columns: built.columns, rows: built.rows };
  });

  return {
    generatedAt: new Date().toISOString(),
    relations: moduleRelations(),
    sections,
  };
}

function buildSection(
  id: SectionId,
  data: {
    sites: Array<{ code: string; name: string; environment: string; address: string | null }>;
    devices: Array<{ hostname: string; role: string; status: string; managementIp: string | null; vendor: string | null; model: string | null; site: { code: string } }>;
    interfaces: Array<{ name: string; ipAddress: string | null; macAddress: string | null; status: string; device: { hostname: string } }>;
    vlans: Array<{ vid: number; name: string; role: string; securityZone: string; status: string; site: { code: string }; subnets: Array<{ cidr: string }> }>;
    networks: Array<{ name: string; cidr: string; family: string; site: { code: string } }>;
    subnets: Array<{ name: string; cidr: string; vlan: { vid: number; name: string }; gatewayAddress: { address: string } | null; network: { name: string; site: { code: string } } }>;
    addresses: Array<{ address: string; role: string; subnet: { cidr: string }; interface: { name: string; device: { hostname: string } } | null }>;
    ports: Array<{
      name: string;
      mode: string;
      status: string;
      device: { hostname: string };
      accessVlan: { vid: number } | null;
      nativeVlan: { vid: number } | null;
      allowedVlans: Array<{ vlan: { vid: number } }>;
      connectedDevice: { hostname: string } | null;
    }>;
    dhcpServers: Array<{ name: string; status: string; address: string | null; site: { code: string }; device: { hostname: string } | null }>;
    dhcpScopes: Array<{
      enabled: boolean;
      gateway: string;
      server: { name: string };
      subnet: { cidr: string; vlan: { vid: number } };
      pools: Array<{ startAddress: string; endAddress: string }>;
    }>;
    dnsServers: Array<{ name: string; status: string; address: string | null; site: { code: string } }>;
    dnsZones: Array<{ name: string; kind: string; enabled: boolean; server: { name: string }; subnet: { cidr: string } | null }>;
    dnsRecords: Array<{ name: string; type: string; rdata: string; zone: { name: string } }>;
    layer3: Array<{ name: string; kind: string; address: string; status: string; device: { hostname: string }; vlan: { vid: number } | null; subnet: { cidr: string } }>;
    routes: Array<{ cidr: string; gateway: string | null; protocol: string; status: string; metric: number; device: { hostname: string } }>;
    zones: Array<{ name: string; description: string | null; vlans: Array<{ vlan: { vid: number; site: { code: string } } }> }>;
    flows: Array<{ priority: number; action: string; protocol: string; source: string; destination: string; enabled: boolean }>;
    links: Array<{
      origin: string;
      status: string;
      sourcePort: string | null;
      targetPort: string | null;
      sourceDevice: { hostname: string } | null;
      targetDevice: { hostname: string } | null;
      sourceMarker: { label: string } | null;
      targetMarker: { label: string } | null;
      vlan: { vid: number } | null;
    }>;
    markers: Array<{ label: string; kind: string; site: { code: string } }>;
    changeVersions: Array<{ number: number; origin: string; simulated: boolean; createdAt: Date; device: { hostname: string } }>;
    changeRequests: Array<{ title: string; phase: string; integration: string; createdAt: Date; device: { hostname: string } }>;
  },
): { columns: string[]; rows: DocRow[] } {
  if (id === "NETWORK") {
    return {
      columns: ["code", "name", "environment", "address"],
      rows: data.sites.map((site) => ({ code: site.code, name: site.name, environment: site.environment, address: site.address })),
    };
  }
  if (id === "INVENTORY") {
    const deviceRows = data.devices.map((device) => ({
      hostname: device.hostname,
      role: device.role,
      status: device.status,
      managementIp: device.managementIp,
      vendor: device.vendor,
      model: device.model,
      site: device.site.code,
      kind: "device",
    }));
    const interfaceRows = data.interfaces.map((item) => ({
      hostname: item.device.hostname,
      role: item.name,
      status: item.status,
      managementIp: item.ipAddress,
      vendor: item.macAddress,
      model: null,
      site: null,
      kind: "interface",
    }));
    return { columns: ["kind", "hostname", "role", "status", "managementIp", "vendor", "model", "site"], rows: [...deviceRows, ...interfaceRows] };
  }
  if (id === "IP_PLAN") {
    const networkRows = data.networks.map((item) => ({
      type: "network",
      name: item.name,
      cidr: item.cidr,
      detail: item.family,
      site: item.site.code,
      vlan: null,
      gateway: null,
    }));
    const subnetRows = data.subnets.map((item) => ({
      type: "subnet",
      name: item.name,
      cidr: item.cidr,
      detail: item.network.name,
      site: item.network.site.code,
      vlan: item.vlan.vid,
      gateway: item.gatewayAddress?.address ?? null,
    }));
    const addressRows = data.addresses.map((item) => ({
      type: "address",
      name: item.interface ? `${item.interface.device.hostname}/${item.interface.name}` : item.role,
      cidr: item.subnet.cidr,
      detail: item.role,
      site: null,
      vlan: null,
      gateway: item.address,
    }));
    return { columns: ["type", "name", "cidr", "detail", "site", "vlan", "gateway"], rows: [...networkRows, ...subnetRows, ...addressRows] };
  }
  if (id === "VLAN_MATRIX") {
    return {
      columns: ["site", "vid", "name", "role", "securityZone", "status", "subnets"],
      rows: data.vlans.map((vlan) => ({
        site: vlan.site.code,
        vid: vlan.vid,
        name: vlan.name,
        role: vlan.role,
        securityZone: vlan.securityZone,
        status: vlan.status,
        subnets: vlan.subnets.map((item) => item.cidr).join(" "),
      })),
    };
  }
  if (id === "SWITCH_PORT_MATRIX") {
    return {
      columns: ["switch", "port", "mode", "status", "accessVlan", "nativeVlan", "allowedVlans", "connected"],
      rows: data.ports.map((port) => ({
        switch: port.device.hostname,
        port: port.name,
        mode: port.mode,
        status: port.status,
        accessVlan: port.accessVlan?.vid ?? null,
        nativeVlan: port.nativeVlan?.vid ?? null,
        allowedVlans: port.allowedVlans.map((item) => item.vlan.vid).join(" "),
        connected: port.connectedDevice?.hostname ?? null,
      })),
    };
  }
  if (id === "DHCP") {
    const servers = data.dhcpServers.map((item) => ({
      type: "server",
      name: item.name,
      detail: item.status,
      address: item.address,
      scope: null,
      vlan: null,
      pool: null,
      site: item.site.code,
    }));
    const scopes = data.dhcpScopes.map((item) => ({
      type: "scope",
      name: item.server.name,
      detail: item.enabled ? "enabled" : "disabled",
      address: item.gateway,
      scope: item.subnet.cidr,
      vlan: item.subnet.vlan.vid,
      pool: item.pools.map((pool) => `${pool.startAddress}-${pool.endAddress}`).join(" "),
      site: null,
    }));
    return { columns: ["type", "name", "detail", "address", "scope", "vlan", "pool", "site"], rows: [...servers, ...scopes] };
  }
  if (id === "DNS") {
    const servers = data.dnsServers.map((item) => ({
      type: "server",
      name: item.name,
      detail: item.status,
      value: item.address,
      zone: null,
      site: item.site.code,
    }));
    const zones = data.dnsZones.map((item) => ({
      type: "zone",
      name: item.name,
      detail: `${item.kind}${item.enabled ? "" : " disabled"}`,
      value: item.subnet?.cidr ?? null,
      zone: item.server.name,
      site: null,
    }));
    const records = data.dnsRecords.map((item) => ({
      type: "record",
      name: item.name,
      detail: item.type,
      value: item.rdata,
      zone: item.zone.name,
      site: null,
    }));
    return { columns: ["type", "name", "detail", "value", "zone", "site"], rows: [...servers, ...zones, ...records] };
  }
  if (id === "ROUTING") {
    const interfaces = data.layer3.map((item) => ({
      type: "interface",
      device: item.device.hostname,
      name: item.name,
      detail: item.kind,
      address: item.address,
      cidr: item.subnet.cidr,
      vlan: item.vlan?.vid ?? null,
      status: item.status,
    }));
    const routes = data.routes.map((item) => ({
      type: "route",
      device: item.device.hostname,
      name: item.cidr,
      detail: item.protocol,
      address: item.gateway,
      cidr: item.cidr,
      vlan: item.metric,
      status: item.status,
    }));
    return { columns: ["type", "device", "name", "detail", "address", "cidr", "vlan", "status"], rows: [...interfaces, ...routes] };
  }
  if (id === "FIREWALL_MATRIX") {
    const zoneRows = data.zones.map((zone) => ({
      type: "zone",
      name: zone.name,
      detail: zone.description,
      source: null,
      destination: null,
      vlans: zone.vlans.map((item) => `${item.vlan.site.code}:${item.vlan.vid}`).join(" "),
    }));
    const flowRows = data.flows.map((flow) => ({
      type: "flow",
      name: `P${flow.priority}`,
      detail: `${flow.action}/${flow.protocol}${flow.enabled ? "" : " disabled"}`,
      source: flow.source,
      destination: flow.destination,
      vlans: null,
    }));
    return { columns: ["type", "name", "detail", "source", "destination", "vlans"], rows: [...zoneRows, ...flowRows] };
  }
  if (id === "TOPOLOGY") {
    const linkRows = data.links.map((link) => ({
      type: "link",
      name: `${link.sourceDevice?.hostname ?? link.sourceMarker?.label ?? "?"}-${link.targetDevice?.hostname ?? link.targetMarker?.label ?? "?"}`,
      detail: `${link.origin}/${link.status}`,
      source: link.sourcePort,
      target: link.targetPort,
      vlan: link.vlan?.vid ?? null,
      site: null,
    }));
    const markerRows = data.markers.map((marker) => ({
      type: "marker",
      name: marker.label,
      detail: marker.kind,
      source: null,
      target: null,
      vlan: null,
      site: marker.site.code,
    }));
    return { columns: ["type", "name", "detail", "source", "target", "vlan", "site"], rows: [...linkRows, ...markerRows] };
  }
  const versions = data.changeVersions.map((item) => ({
    type: "version",
    title: `v${item.number}`,
    device: item.device.hostname,
    detail: item.origin,
    phase: item.simulated ? "simulated" : "recorded",
    createdAt: item.createdAt.toISOString(),
  }));
  const requests = data.changeRequests.map((item) => ({
    type: "request",
    title: item.title,
    device: item.device.hostname,
    detail: item.integration,
    phase: item.phase,
    createdAt: item.createdAt.toISOString(),
  }));
  return { columns: ["type", "title", "device", "detail", "phase", "createdAt"], rows: [...requests, ...versions] };
}
