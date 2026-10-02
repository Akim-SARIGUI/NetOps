import "dotenv/config";
import { kindIsCritical } from "../src/server/automation/evaluate";
import { probe, simulateObservations } from "../src/server/discovery/evaluate";
import { prisma } from "../src/server/prisma";
import { hashPassword } from "../src/server/auth/passwords";
import type { RoleName } from "../src/server/rbac/permissions";

const DEMO_PASSWORD = "NetOps-Demo-2026!";

const USERS: Array<{ email: string; name: string; isSuperAdmin: boolean; role?: RoleName }> = [
  { email: "superadmin@netops.local", name: "Super administrateur", isSuperAdmin: true },
  { email: "admin@netops.local", name: "Administrateur réseau", isSuperAdmin: false, role: "NETWORK_ADMIN" },
  { email: "operator@netops.local", name: "Opérateur réseau", isSuperAdmin: false, role: "NETWORK_OPERATOR" },
  { email: "auditor@netops.local", name: "Auditeur", isSuperAdmin: false, role: "AUDITOR" },
  { email: "viewer@netops.local", name: "Lecteur", isSuperAdmin: false, role: "VIEWER" },
];

async function main() {
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  const organization = await prisma.organization.upsert({
    where: { slug: "netops-demo" },
    update: { name: "NetOps Démo" },
    create: { name: "NetOps Démo", slug: "netops-demo" },
  });

  for (const account of USERS) {
    const user = await prisma.user.upsert({
      where: { email: account.email },
      update: {
        name: account.name,
        passwordHash,
        isActive: true,
        isSuperAdmin: account.isSuperAdmin,
      },
      create: {
        email: account.email,
        name: account.name,
        passwordHash,
        isSuperAdmin: account.isSuperAdmin,
      },
    });

    if (account.role) {
      await prisma.membership.upsert({
        where: { userId_organizationId: { userId: user.id, organizationId: organization.id } },
        update: { role: account.role },
        create: { userId: user.id, organizationId: organization.id, role: account.role },
      });
    }
  }

  const paris = await prisma.site.upsert({
    where: { organizationId_code: { organizationId: organization.id, code: "PARIS" } },
    update: {
      name: "Siège Paris",
      environment: "PRODUCTION",
      address: "12 rue de la Convention, 75015 Paris",
    },
    create: {
      organizationId: organization.id,
      name: "Siège Paris",
      code: "PARIS",
      environment: "PRODUCTION",
      address: "12 rue de la Convention, 75015 Paris",
    },
  });

  const buildingA = await prisma.building.upsert({
    where: { siteId_code: { siteId: paris.id, code: "A" } },
    update: { name: "Bâtiment A" },
    create: { siteId: paris.id, name: "Bâtiment A", code: "A" },
  });

  const mdf = await prisma.room.upsert({
    where: { buildingId_code: { buildingId: buildingA.id, code: "MDF" } },
    update: { name: "Salle MDF" },
    create: { buildingId: buildingA.id, name: "Salle MDF", code: "MDF" },
  });

  await prisma.rack.upsert({
    where: { roomId_code: { roomId: mdf.id, code: "R01" } },
    update: { name: "Baie R01", heightU: 42 },
    create: { roomId: mdf.id, name: "Baie R01", code: "R01", heightU: 42 },
  });
  await prisma.rack.upsert({
    where: { roomId_code: { roomId: mdf.id, code: "R02" } },
    update: { name: "Baie R02", heightU: 42 },
    create: { roomId: mdf.id, name: "Baie R02", code: "R02", heightU: 42 },
  });

  const lab = await prisma.site.upsert({
    where: { organizationId_code: { organizationId: organization.id, code: "LAB" } },
    update: { name: "Laboratoire", environment: "LAB", address: "Environnement isolé" },
    create: {
      organizationId: organization.id,
      name: "Laboratoire",
      code: "LAB",
      environment: "LAB",
      address: "Environnement isolé",
    },
  });
  await prisma.site.upsert({
    where: { organizationId_code: { organizationId: organization.id, code: "DEV" } },
    update: { name: "Développement", environment: "DEV", address: "Environnement de développement" },
    create: {
      organizationId: organization.id,
      name: "Développement",
      code: "DEV",
      environment: "DEV",
      address: "Environnement de développement",
    },
  });
  await prisma.site.upsert({
    where: { organizationId_code: { organizationId: organization.id, code: "STAGING" } },
    update: { name: "Préproduction", environment: "STAGING", address: "Environnement de préproduction" },
    create: {
      organizationId: organization.id,
      name: "Préproduction",
      code: "STAGING",
      environment: "STAGING",
      address: "Environnement de préproduction",
    },
  });

  const labBuilding = await prisma.building.upsert({
    where: { siteId_code: { siteId: lab.id, code: "LAB" } },
    update: { name: "Bâtiment labo" },
    create: { siteId: lab.id, name: "Bâtiment labo", code: "LAB" },
  });

  const workshop = await prisma.room.upsert({
    where: { buildingId_code: { buildingId: labBuilding.id, code: "ATELIER" } },
    update: { name: "Atelier" },
    create: { buildingId: labBuilding.id, name: "Atelier", code: "ATELIER" },
  });

  await prisma.rack.upsert({
    where: { roomId_code: { roomId: workshop.id, code: "LAB-01" } },
    update: { name: "Baie LAB-01", heightU: 12 },
    create: { roomId: workshop.id, name: "Baie LAB-01", code: "LAB-01", heightU: 12 },
  });

  const rackR01 = await prisma.rack.findUniqueOrThrow({ where: { roomId_code: { roomId: mdf.id, code: "R01" } } });
  const rackR02 = await prisma.rack.findUniqueOrThrow({ where: { roomId_code: { roomId: mdf.id, code: "R02" } } });

  async function upsertDevice(hostname: string, data: Parameters<typeof prisma.device.upsert>[0]["create"]) {
    return prisma.device.upsert({
      where: { organizationId_hostname: { organizationId: organization.id, hostname } },
      update: data,
      create: data,
    });
  }

  const core = await upsertDevice("core-paris", {
    organizationId: organization.id,
    siteId: paris.id,
    buildingId: buildingA.id,
    roomId: mdf.id,
    rackId: rackR01.id,
    role: "ROUTER",
    hostname: "core-paris",
    managementIp: "10.0.0.1",
    vendor: "Cisco",
    model: "ISR4451",
    os: "IOS-XE",
    osVersion: "17.12.4",
    serialNumber: "FCZ2451PAR01",
    status: "ACTIVE",
    description: "Routeur de cœur du siège",
  });

  const switchA = await upsertDevice("sw-access-a", {
    organizationId: organization.id,
    siteId: paris.id,
    buildingId: buildingA.id,
    roomId: mdf.id,
    rackId: rackR01.id,
    role: "SWITCH",
    hostname: "sw-access-a",
    managementIp: "10.0.0.2",
    vendor: "Cisco",
    model: "C9300-48P",
    os: "IOS-XE",
    osVersion: "17.12.4",
    serialNumber: "FCW9300PAR01",
    status: "ACTIVE",
    description: "Commutateur d'accès",
  });

  const firewall = await upsertDevice("fw-edge", {
    organizationId: organization.id,
    siteId: paris.id,
    buildingId: buildingA.id,
    roomId: mdf.id,
    rackId: rackR02.id,
    role: "FIREWALL",
    hostname: "fw-edge",
    managementIp: "10.0.0.3",
    vendor: "Fortinet",
    model: "FortiGate 200F",
    os: "FortiOS",
    osVersion: "7.4.5",
    serialNumber: "FGT200FPAR01",
    status: "ACTIVE",
    description: "Pare-feu de bordure",
  });

  const server = await upsertDevice("srv-dc1", {
    organizationId: organization.id,
    siteId: paris.id,
    buildingId: buildingA.id,
    roomId: mdf.id,
    rackId: rackR02.id,
    role: "SERVER",
    hostname: "srv-dc1",
    managementIp: "10.0.0.10",
    vendor: "Dell",
    model: "PowerEdge R750",
    os: "Ubuntu",
    osVersion: "24.04",
    serialNumber: "DELLR750PAR01",
    status: "ACTIVE",
    description: "Serveur d'infrastructure",
  });

  const accessPoint = await upsertDevice("ap-hall", {
    organizationId: organization.id,
    siteId: paris.id,
    buildingId: buildingA.id,
    roomId: mdf.id,
    rackId: null,
    role: "ACCESS_POINT",
    hostname: "ap-hall",
    managementIp: "10.0.0.20",
    vendor: "Aruba",
    model: "AP-515",
    os: "ArubaOS",
    osVersion: "8.10.0",
    serialNumber: "ARUBA515PAR01",
    status: "ACTIVE",
    description: "Point d'accès du hall, hors baie",
  });

  const client = await upsertDevice("pc-accueil", {
    organizationId: organization.id,
    siteId: paris.id,
    buildingId: null,
    roomId: null,
    rackId: null,
    role: "CLIENT",
    hostname: "pc-accueil",
    managementIp: "10.1.10.25",
    vendor: "Dell",
    model: "OptiPlex",
    os: "Windows",
    osVersion: "11",
    serialNumber: "OPTIPLEXPAR01",
    status: "PLANNED",
    description: "Poste d'accueil, rattaché au site uniquement",
  });

  async function upsertInterface(
    deviceId: string,
    name: string,
    data: { ipAddress?: string; macAddress?: string; speedMbps?: number; duplex?: "FULL" | "AUTO"; status?: "UP" | "DOWN"; description?: string },
  ) {
    return prisma.networkInterface.upsert({
      where: { deviceId_name: { deviceId, name } },
      update: data,
      create: { deviceId, name, ...data },
    });
  }

  await upsertInterface(core.id, "Gi0/0", {
    ipAddress: "10.0.0.1",
    macAddress: "00:1a:2b:3c:4d:01",
    speedMbps: 1000,
    duplex: "FULL",
    status: "UP",
    description: "Management",
  });
  await upsertInterface(core.id, "Gi0/1", {
    ipAddress: "10.0.1.1",
    macAddress: "00:1a:2b:3c:4d:02",
    speedMbps: 10000,
    duplex: "FULL",
    status: "UP",
    description: "Uplink",
  });
  await upsertInterface(switchA.id, "Gi1/0/1", {
    ipAddress: "10.0.0.2",
    macAddress: "00:1a:2b:3c:4d:11",
    speedMbps: 1000,
    duplex: "FULL",
    status: "UP",
  });
  await upsertInterface(firewall.id, "port1", {
    ipAddress: "10.0.0.3",
    macAddress: "00:1a:2b:3c:4d:21",
    speedMbps: 1000,
    duplex: "FULL",
    status: "UP",
  });
  await upsertInterface(server.id, "eth0", {
    ipAddress: "10.0.0.10",
    macAddress: "00:1a:2b:3c:4d:31",
    speedMbps: 10000,
    duplex: "FULL",
    status: "UP",
  });
  await upsertInterface(accessPoint.id, "eth0", {
    ipAddress: "10.0.0.20",
    macAddress: "00:1a:2b:3c:4d:41",
    speedMbps: 1000,
    duplex: "FULL",
    status: "UP",
  });
  await upsertInterface(client.id, "eth0", {
    ipAddress: "10.1.10.25",
    macAddress: "00:1a:2b:3c:4d:51",
    speedMbps: 1000,
    duplex: "AUTO",
    status: "DOWN",
  });

  async function upsertVlan(vid: number, data: {
    name: string;
    description: string;
    role: "DATA" | "VOICE" | "MANAGEMENT" | "GUEST" | "SERVER" | "TRANSIT" | "NATIVE";
    securityZone: "TRUST" | "UNTRUST" | "DMZ" | "GUEST" | "MANAGEMENT" | "INTERNAL";
  }) {
    return prisma.vlan.upsert({
      where: { siteId_vid: { siteId: paris.id, vid } },
      update: data,
      create: { siteId: paris.id, vid, status: "ACTIVE", ...data },
    });
  }

  const vlanUsers = await upsertVlan(10, {
    name: "Utilisateurs",
    description: "Postes utilisateurs du siège",
    role: "DATA",
    securityZone: "TRUST",
  });
  const vlanVoice = await upsertVlan(20, {
    name: "Voix",
    description: "Téléphonie",
    role: "VOICE",
    securityZone: "TRUST",
  });
  const vlanServers = await upsertVlan(30, {
    name: "Serveurs",
    description: "Serveurs d'infrastructure",
    role: "SERVER",
    securityZone: "INTERNAL",
  });
  const vlanMgmt = await upsertVlan(99, {
    name: "Management",
    description: "Administration des équipements",
    role: "MANAGEMENT",
    securityZone: "MANAGEMENT",
  });
  const vlanTransit = await upsertVlan(40, {
    name: "Transit",
    description: "Liaison entre le cœur et l'accès",
    role: "TRANSIT",
    securityZone: "INTERNAL",
  });

  async function upsertPort(
    name: string,
    data: {
      mode: "ACCESS" | "TRUNK";
      status?: "UP" | "DOWN" | "ADMIN_DOWN" | "ERR_DISABLED";
      accessVlanId?: string | null;
      nativeVlanId?: string | null;
      allowedVlanIds?: string[];
      speedMbps?: number;
      duplex?: "FULL" | "AUTO" | "HALF";
      description?: string;
      connectedDeviceId?: string | null;
      macAddress?: string | null;
      poe?: "OFF" | "ON" | "FAULT";
    },
  ) {
    const { allowedVlanIds = [], ...fields } = data;
    const port = await prisma.switchPort.upsert({
      where: { deviceId_name: { deviceId: switchA.id, name } },
      update: fields,
      create: { deviceId: switchA.id, name, ...fields },
    });
    await prisma.switchPortVlan.deleteMany({ where: { portId: port.id } });
    if (allowedVlanIds.length > 0) {
      await prisma.switchPortVlan.createMany({
        data: allowedVlanIds.map((vlanId) => ({ portId: port.id, vlanId })),
      });
    }
    return port;
  }

  await upsertPort("Gi0/1", {
    mode: "TRUNK",
    status: "UP",
    accessVlanId: null,
    nativeVlanId: vlanMgmt.id,
    allowedVlanIds: [vlanUsers.id, vlanVoice.id, vlanServers.id, vlanMgmt.id],
    speedMbps: 10000,
    duplex: "FULL",
    description: "Liaison vers le cœur",
    poe: "OFF",
  });
  await upsertPort("Gi0/2", {
    mode: "TRUNK",
    status: "UP",
    accessVlanId: null,
    nativeVlanId: vlanUsers.id,
    allowedVlanIds: [vlanUsers.id, vlanVoice.id, vlanServers.id],
    speedMbps: 10000,
    duplex: "FULL",
    description: "Liaison secondaire",
    poe: "OFF",
  });
  await upsertPort("Gi0/3", {
    mode: "ACCESS",
    status: "UP",
    accessVlanId: vlanUsers.id,
    nativeVlanId: null,
    speedMbps: 1000,
    duplex: "FULL",
    description: "Poste utilisateur",
    poe: "OFF",
  });
  await upsertPort("Gi0/4", {
    mode: "ACCESS",
    status: "UP",
    accessVlanId: vlanVoice.id,
    nativeVlanId: null,
    speedMbps: 1000,
    duplex: "FULL",
    description: "Point d'accès du hall",
    connectedDeviceId: accessPoint.id,
    macAddress: "00:1a:2b:3c:4d:42",
    poe: "ON",
  });
  await upsertPort("Gi0/5", {
    mode: "ACCESS",
    status: "UP",
    accessVlanId: vlanServers.id,
    nativeVlanId: null,
    speedMbps: 1000,
    duplex: "FULL",
    description: "Serveur",
    poe: "OFF",
  });

  async function upsertNetwork(name: string, cidr: string, description: string) {
    const family = cidr.includes(":") ? "IPV6" : "IPV4";
    const prefixLength = Number(cidr.split("/")[1]);
    return prisma.ipNetwork.upsert({
      where: { siteId_cidr: { siteId: paris.id, cidr } },
      update: { name, description, family, prefixLength },
      create: { organizationId: organization.id, siteId: paris.id, name, description, cidr, family, prefixLength },
    });
  }

  async function upsertSubnet(networkId: string, vlanId: string, name: string, cidr: string, gateway: string, description: string) {
    const family = cidr.includes(":") ? "IPV6" : "IPV4";
    const prefixLength = Number(cidr.split("/")[1]);
    const subnet = await prisma.ipSubnet.upsert({
      where: { networkId_cidr: { networkId, cidr } },
      update: { name, description, vlanId, family, prefixLength },
      create: { networkId, vlanId, name, description, cidr, family, prefixLength },
    });
    const address = await prisma.ipAddress.upsert({
      where: { organizationId_address: { organizationId: organization.id, address: gateway } },
      update: { subnetId: subnet.id, role: "GATEWAY" },
      create: { organizationId: organization.id, subnetId: subnet.id, address: gateway, role: "GATEWAY" },
    });
    return prisma.ipSubnet.update({ where: { id: subnet.id }, data: { gatewayAddressId: address.id } });
  }

  async function allocate(subnetId: string, address: string, interfaceName: { deviceId: string; name: string }, description?: string) {
    const networkInterface = await prisma.networkInterface.findUniqueOrThrow({
      where: { deviceId_name: interfaceName },
    });
    await prisma.ipAddress.upsert({
      where: { organizationId_address: { organizationId: organization.id, address } },
      update: { subnetId, role: address.endsWith(".1") || address.endsWith("::1") ? "GATEWAY" : "ALLOCATED", interfaceId: networkInterface.id, description },
      create: {
        organizationId: organization.id,
        subnetId,
        address,
        role: address.endsWith(".1") || address.endsWith("::1") ? "GATEWAY" : "ALLOCATED",
        interfaceId: networkInterface.id,
        description,
      },
    });
  }

  const administration = await upsertNetwork("Administration", "10.0.0.0/16", "Réseau d'administration du siège");
  const campus = await upsertNetwork("Campus", "10.1.0.0/16", "Réseau des utilisateurs, de la voix et des serveurs");
  const campus6 = await upsertNetwork("Campus IPv6", "fd00:10::/48", "Plan IPv6 du campus");

  const mgmtSubnet = await upsertSubnet(administration.id, vlanMgmt.id, "Administration", "10.0.0.0/24", "10.0.0.1", "Adresses de management");
  const transitSubnet = await upsertSubnet(administration.id, vlanTransit.id, "Transit", "10.0.1.0/24", "10.0.1.1", "Liaison cœur");
  const usersSubnet = await upsertSubnet(campus.id, vlanUsers.id, "Utilisateurs", "10.1.10.0/24", "10.1.10.1", "Postes du siège");
  const voiceSubnet = await upsertSubnet(campus.id, vlanVoice.id, "Voix", "10.1.20.0/24", "10.1.20.1", "Téléphonie");
  await upsertSubnet(campus.id, vlanServers.id, "Serveurs", "10.1.30.0/24", "10.1.30.1", "Serveurs d'infrastructure");
  await upsertSubnet(campus6.id, vlanUsers.id, "Utilisateurs IPv6", "fd00:10:0:10::/64", "fd00:10:0:10::1", "Plan IPv6 des postes");

  await allocate(mgmtSubnet.id, "10.0.0.1", { deviceId: core.id, name: "Gi0/0" }, "Passerelle d'administration");
  await allocate(mgmtSubnet.id, "10.0.0.2", { deviceId: switchA.id, name: "Gi1/0/1" });
  await allocate(mgmtSubnet.id, "10.0.0.3", { deviceId: firewall.id, name: "port1" });
  await allocate(mgmtSubnet.id, "10.0.0.10", { deviceId: server.id, name: "eth0" });
  await allocate(mgmtSubnet.id, "10.0.0.20", { deviceId: accessPoint.id, name: "eth0" });
  await allocate(transitSubnet.id, "10.0.1.1", { deviceId: core.id, name: "Gi0/1" }, "Passerelle de transit");
  await allocate(usersSubnet.id, "10.1.10.25", { deviceId: client.id, name: "eth0" }, "Poste d'accueil");
  await prisma.ipAddress.upsert({
    where: { organizationId_address: { organizationId: organization.id, address: "10.1.10.10" } },
    update: { subnetId: usersSubnet.id, role: "RESERVED", description: "Imprimante d'accueil" },
    create: {
      organizationId: organization.id,
      subnetId: usersSubnet.id,
      address: "10.1.10.10",
      role: "RESERVED",
      description: "Imprimante d'accueil",
    },
  });

  const dhcpServer = await prisma.dhcpServer.upsert({
    where: { siteId_name: { siteId: paris.id, name: "dhcp-paris" } },
    update: {
      deviceId: server.id,
      address: "10.0.0.10",
      status: "ACTIVE",
      description: "Service DHCP simulé du siège, porté par srv-dc1. Aucun serveur réel n'est contacté.",
    },
    create: {
      organizationId: organization.id,
      siteId: paris.id,
      deviceId: server.id,
      name: "dhcp-paris",
      address: "10.0.0.10",
      status: "ACTIVE",
      description: "Service DHCP simulé du siège, porté par srv-dc1. Aucun serveur réel n'est contacté.",
    },
  });
  const voiceScope = await prisma.dhcpScope.upsert({
    where: { subnetId: voiceSubnet.id },
    update: {
      serverId: dhcpServer.id,
      gateway: "10.1.20.1",
      dnsServers: ["10.0.0.10"],
      domain: "netops.local",
      leaseSeconds: 28_800,
      enabled: true,
      description: "Téléphones du VLAN 20",
    },
    create: {
      subnetId: voiceSubnet.id,
      serverId: dhcpServer.id,
      gateway: "10.1.20.1",
      dnsServers: ["10.0.0.10"],
      domain: "netops.local",
      leaseSeconds: 28_800,
      enabled: true,
      description: "Téléphones du VLAN 20",
    },
  });
  const voicePool = await prisma.dhcpPool.findFirst({ where: { scopeId: voiceScope.id, startAddress: "10.1.20.100", endAddress: "10.1.20.200" } });
  if (!voicePool) {
    await prisma.dhcpPool.create({ data: { scopeId: voiceScope.id, startAddress: "10.1.20.100", endAddress: "10.1.20.200" } });
  }
  await prisma.dhcpReservation.upsert({
    where: { scopeId_macAddress: { scopeId: voiceScope.id, macAddress: "00:1a:2b:3c:4d:20" } },
    update: { address: "10.1.20.120", hostname: "phone-accueil", description: "Téléphone d'accueil" },
    create: {
      scopeId: voiceScope.id,
      address: "10.1.20.120",
      macAddress: "00:1a:2b:3c:4d:20",
      hostname: "phone-accueil",
      description: "Téléphone d'accueil",
    },
  });
  const leaseStart = new Date("2026-10-02T08:00:00.000Z");
  const leaseEnd = new Date("2027-01-01T08:00:00.000Z");
  await prisma.dhcpLease.upsert({
    where: { scopeId_address: { scopeId: voiceScope.id, address: "10.1.20.100" } },
    update: { macAddress: "00:1a:2b:3c:4d:21", hostname: "phone-hall", state: "ACTIVE", origin: "SIMULATION", startsAt: leaseStart, expiresAt: leaseEnd },
    create: {
      scopeId: voiceScope.id,
      address: "10.1.20.100",
      macAddress: "00:1a:2b:3c:4d:21",
      hostname: "phone-hall",
      state: "ACTIVE",
      origin: "SIMULATION",
      startsAt: leaseStart,
      expiresAt: leaseEnd,
    },
  });
  const relayInterface = await prisma.networkInterface.findUniqueOrThrow({ where: { deviceId_name: { deviceId: core.id, name: "Gi0/1" } } });
  await prisma.dhcpRelay.upsert({
    where: { subnetId_serverId: { subnetId: voiceSubnet.id, serverId: dhcpServer.id } },
    update: { interfaceId: relayInterface.id, helperAddress: "10.0.0.10", description: "Relais du VLAN voix vers dhcp-paris" },
    create: {
      subnetId: voiceSubnet.id,
      serverId: dhcpServer.id,
      interfaceId: relayInterface.id,
      helperAddress: "10.0.0.10",
      description: "Relais du VLAN voix vers dhcp-paris",
    },
  });

  const dnsServer = await prisma.dnsServer.upsert({
    where: { siteId_name: { siteId: paris.id, name: "dns-paris" } },
    update: {
      deviceId: server.id,
      address: "10.0.0.10",
      status: "ACTIVE",
      description: "Service DNS local du siège, porté par srv-dc1. Aucun serveur DNS réel n'est interrogé.",
    },
    create: {
      organizationId: organization.id,
      siteId: paris.id,
      deviceId: server.id,
      name: "dns-paris",
      address: "10.0.0.10",
      status: "ACTIVE",
      description: "Service DNS local du siège, porté par srv-dc1. Aucun serveur DNS réel n'est interrogé.",
    },
  });

  async function ensureZone(name: string, kind: "FORWARD" | "REVERSE", subnetId: string | null, description: string) {
    return prisma.dnsZone.upsert({
      where: { organizationId_name: { organizationId: organization.id, name } },
      update: { serverId: dnsServer.id, kind, subnetId, ttl: 3600, enabled: true, description },
      create: { organizationId: organization.id, serverId: dnsServer.id, kind, name, subnetId, ttl: 3600, enabled: true, description },
    });
  }

  async function ensureRecord(zoneId: string, name: string, type: "A" | "AAAA" | "CNAME" | "MX" | "NS" | "PTR" | "TXT" | "SRV", rdata: string) {
    await prisma.dnsRecord.upsert({
      where: { zoneId_name_type_rdata: { zoneId, name, type, rdata } },
      update: {},
      create: { zoneId, name, type, rdata },
    });
  }

  const forwardZone = await ensureZone("entreprise.local", "FORWARD", null, "Zone interne du siège");
  const adminReverse = await ensureZone("0.0.10.in-addr.arpa", "REVERSE", mgmtSubnet.id, "Inverse du réseau d'administration");
  const usersReverse = await ensureZone("10.1.10.in-addr.arpa", "REVERSE", usersSubnet.id, "Inverse des postes");
  await ensureRecord(forwardZone.id, "@", "NS", "dns.entreprise.local");
  await ensureRecord(forwardZone.id, "dns", "A", "10.0.0.10");
  await ensureRecord(forwardZone.id, "dhcp", "A", "10.0.0.10");
  await ensureRecord(forwardZone.id, "intranet", "A", "10.1.10.25");
  await ensureRecord(forwardZone.id, "monitoring", "A", "10.0.0.3");
  await ensureRecord(adminReverse.id, "10", "PTR", "dns.entreprise.local");
  await ensureRecord(adminReverse.id, "3", "PTR", "monitoring.entreprise.local");
  await ensureRecord(usersReverse.id, "25", "PTR", "intranet.entreprise.local");
  const dnsNoted = await prisma.dnsChange.findFirst({ where: { zoneId: forwardZone.id, action: "zone.seed" } });
  if (!dnsNoted) {
    await prisma.dnsChange.create({
      data: {
        zoneId: forwardZone.id,
        action: "zone.seed",
        summary: "Zone entreprise.local importée : intranet, dns, dhcp et monitoring",
      },
    });
  }

  const gi00 = await prisma.networkInterface.findUniqueOrThrow({ where: { deviceId_name: { deviceId: core.id, name: "Gi0/0" } } });
  async function ensureLayer3(name: string, data: {
    kind: "PHYSICAL" | "SVI" | "SUBINTERFACE";
    vlanId: string;
    parentInterfaceId: string | null;
    address: string;
    subnetId: string;
    description: string;
  }) {
    return prisma.layer3Interface.upsert({
      where: { deviceId_name: { deviceId: core.id, name } },
      update: { ...data, status: "ACTIVE" },
      create: { deviceId: core.id, name, status: "ACTIVE", ...data },
    });
  }
  const layerMgmt = await ensureLayer3("Gi0/0", {
    kind: "PHYSICAL",
    vlanId: vlanMgmt.id,
    parentInterfaceId: gi00.id,
    address: "10.0.0.1",
    subnetId: mgmtSubnet.id,
    description: "Interface physique d'administration",
  });
  const layerTransit = await ensureLayer3("Gi0/1", {
    kind: "PHYSICAL",
    vlanId: vlanTransit.id,
    parentInterfaceId: relayInterface.id,
    address: "10.0.1.1",
    subnetId: transitSubnet.id,
    description: "Interface physique de transit",
  });
  await ensureLayer3("Vlan10", {
    kind: "SVI",
    vlanId: vlanUsers.id,
    parentInterfaceId: null,
    address: "10.1.10.1",
    subnetId: usersSubnet.id,
    description: "SVI du VLAN utilisateurs",
  });
  await ensureLayer3("Gi0/1.20", {
    kind: "SUBINTERFACE",
    vlanId: vlanVoice.id,
    parentInterfaceId: relayInterface.id,
    address: "10.1.20.1",
    subnetId: voiceSubnet.id,
    description: "Router-on-a-stick du VLAN voix",
  });
  async function ensureRoute(cidr: string, data: {
    destination: string;
    prefixLength: number;
    gateway: string;
    protocol: "STATIC" | "DEFAULT";
    description: string;
  }) {
    await prisma.route.upsert({
      where: { deviceId_cidr: { deviceId: core.id, cidr } },
      update: { ...data, layer3InterfaceId: layerMgmt.id, metric: 1, status: "ACTIVE" },
      create: { deviceId: core.id, cidr, layer3InterfaceId: layerMgmt.id, metric: 1, status: "ACTIVE", ...data },
    });
  }
  await ensureRoute("10.1.30.0/24", {
    destination: "10.1.30.0",
    prefixLength: 24,
    gateway: "10.0.0.3",
    protocol: "STATIC",
    description: "Serveurs joignables par le pare-feu",
  });
  await ensureRoute("0.0.0.0/0", {
    destination: "0.0.0.0",
    prefixLength: 0,
    gateway: "10.0.0.3",
    protocol: "DEFAULT",
    description: "Route par défaut vers le pare-feu",
  });
  const ospf = await prisma.ospfProcess.upsert({
    where: { deviceId: core.id },
    update: { processId: 1, routerId: "10.0.0.1", status: "PLANNED", description: "Processus prévu. Aucun voisin n'est négocié." },
    create: { deviceId: core.id, processId: 1, routerId: "10.0.0.1", status: "PLANNED", description: "Processus prévu. Aucun voisin n'est négocié." },
  });
  const area = await prisma.ospfArea.upsert({
    where: { processId_areaId: { processId: ospf.id, areaId: "0.0.0.0" } },
    update: {},
    create: { processId: ospf.id, areaId: "0.0.0.0" },
  });
  await prisma.layer3Interface.update({ where: { id: layerTransit.id }, data: { ospfAreaId: area.id } });

  async function ensureFirewallZone(name: string, description: string, vlanId?: string) {
    const zone = await prisma.firewallZone.upsert({
      where: { organizationId_name: { organizationId: organization.id, name } },
      update: { description },
      create: { organizationId: organization.id, name, description },
    });
    if (vlanId) {
      await prisma.firewallZoneVlan.upsert({
        where: { vlanId },
        update: { zoneId: zone.id },
        create: { zoneId: zone.id, vlanId },
      });
    }
    return zone;
  }
  await ensureFirewallZone("GUEST", "Invités, sans VLAN pour l'instant");
  await ensureFirewallZone("INTERNET", "Extérieur non maîtrisé");
  await ensureFirewallZone("INTERNAL", "Réseaux internes de confiance limitée", vlanVoice.id);
  await ensureFirewallZone("IT", "Postes informatiques", vlanUsers.id);
  await ensureFirewallZone("SERVERS", "Serveurs d'infrastructure", vlanServers.id);
  await ensureFirewallZone("MANAGEMENT", "Administration des équipements", vlanMgmt.id);
  async function ensureFlow(priority: number, source: string, destination: string, action: "ALLOW" | "DENY", logging = false) {
    await prisma.flowRule.upsert({
      where: { organizationId_priority: { organizationId: organization.id, priority } },
      update: { source, destination, protocol: "ANY", sourcePort: null, destinationPort: null, action, logging, enabled: true },
      create: { organizationId: organization.id, priority, source, destination, protocol: "ANY", action, logging, enabled: true },
    });
  }
  await ensureFlow(100, "GUEST", "INTERNET", "ALLOW");
  await ensureFlow(110, "GUEST", "INTERNAL", "DENY", true);
  await ensureFlow(200, "IT", "SERVERS", "ALLOW");
  await ensureFlow(210, "IT", "MANAGEMENT", "ALLOW");
  const edgeAcl = await prisma.acl.upsert({
    where: { organizationId_name: { organizationId: organization.id, name: "bordure" } },
    update: { deviceId: firewall.id, status: "PLANNED", description: "ACL prévue sur fw-edge. Aucun pare-feu physique n'est configuré." },
    create: { organizationId: organization.id, deviceId: firewall.id, name: "bordure", status: "PLANNED", description: "ACL prévue sur fw-edge. Aucun pare-feu physique n'est configuré." },
  });
  async function ensureAclRule(priority: number, source: string, destination: string, destinationPort: string, logging: boolean) {
    await prisma.aclRule.upsert({
      where: { aclId_priority: { aclId: edgeAcl.id, priority } },
      update: { source, destination, protocol: "TCP", sourcePort: null, destinationPort, action: "ALLOW", logging, enabled: true },
      create: { aclId: edgeAcl.id, priority, source, destination, protocol: "TCP", sourcePort: null, destinationPort, action: "ALLOW", logging, enabled: true },
    });
  }
  await ensureAclRule(100, "10.1.10.0/24", "10.1.30.0/24", "443", false);
  await ensureAclRule(110, "10.1.10.0/24", "10.0.0.0/24", "22", true);

  const internet = await prisma.topologyMarker.upsert({
    where: { siteId_kind: { siteId: paris.id, kind: "INTERNET" } },
    update: { label: "Internet", simulated: true, x: 80, y: 160 },
    create: { organizationId: organization.id, siteId: paris.id, kind: "INTERNET", label: "Internet", simulated: true, x: 80, y: 160 },
  });
  const existingInternetLink = await prisma.topologyLink.findFirst({ where: { sourceMarkerId: internet.id, targetDeviceId: firewall.id } });
  if (existingInternetLink) {
    await prisma.topologyLink.update({
      where: { id: existingInternetLink.id },
      data: { sourcePort: "extérieur", targetPort: "port1", speedMbps: 1000, status: "UP", trafficBps: null, origin: "SIMULATION", vlanId: null },
    });
  } else {
    await prisma.topologyLink.create({
      data: {
        organizationId: organization.id,
        sourceMarkerId: internet.id,
        targetDeviceId: firewall.id,
        sourcePort: "extérieur",
        targetPort: "port1",
        speedMbps: 1000,
        status: "UP",
        origin: "SIMULATION",
      },
    });
  }
  for (const protocol of ["LLDP", "CDP"] as const) {
    await prisma.topologyDiscovery.upsert({
      where: { organizationId_protocol: { organizationId: organization.id, protocol } },
      update: { status: "PLANNED" },
      create: { organizationId: organization.id, protocol, status: "PLANNED" },
    });
  }

  for (const device of [core, switchA, firewall, server, accessPoint, client]) {
    await prisma.monitoringTarget.upsert({
      where: { deviceId: device.id },
      update: { mode: "SIMULATION", enabled: true, packetLossThreshold: 2 },
      create: { organizationId: organization.id, deviceId: device.id, mode: "SIMULATION", packetLossThreshold: 2 },
    });
  }

  const inventory = await prisma.device.findMany({
    where: { organizationId: organization.id },
    select: { id: true, hostname: true, managementIp: true, interfaces: { select: { macAddress: true } } },
  });
  const observations = simulateObservations(
    inventory.map((device) => ({
      id: device.id,
      hostname: device.hostname,
      managementIp: device.managementIp,
      macAddresses: device.interfaces.flatMap((item) => (item.macAddress ? [item.macAddress] : [])),
    })),
  );
  const simulation = probe("SIMULATION");
  let demonstration = await prisma.discoveryRun.findFirst({ where: { organizationId: organization.id, label: "Démonstration" } });
  if (demonstration) {
    await prisma.discoveryFinding.deleteMany({ where: { runId: demonstration.id } });
    await prisma.discoveryProbe.deleteMany({ where: { runId: demonstration.id } });
    demonstration = await prisma.discoveryRun.update({
      where: { id: demonstration.id },
      data: { siteId: paris.id, status: "DISCOVERY", simulated: true },
    });
  } else {
    demonstration = await prisma.discoveryRun.create({
      data: { organizationId: organization.id, siteId: paris.id, label: "Démonstration", status: "DISCOVERY", simulated: true },
    });
  }
  await prisma.discoveryProbe.create({ data: { runId: demonstration.id, connector: "SIMULATION", available: true, message: simulation.message } });
  await prisma.discoveryFinding.createMany({
    data: observations.map((finding, position) => ({
      runId: demonstration!.id,
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
    })),
  });

  const automationTemplates = [
    { name: "Bannière", kind: "BANNER" as const, body: "banner motd ^\n{{hostname}} · {{role}}\n^" },
    { name: "Interface de management", kind: "INTERFACE" as const, body: "interface {{managementInterface}}\n description Management {{hostname}}\n ip address {{managementIp}}" },
    { name: "VLAN d'accès", kind: "VLAN" as const, body: "vlan {{vid}}\n name {{vlanName}}" },
    { name: "Route statique", kind: "ROUTING" as const, body: "! {{label}}\nip route {{destination}} {{mask}} {{gateway}}" },
    { name: "ACL de bordure", kind: "FIREWALL" as const, body: "ip access-list extended bordure\n permit tcp {{source}} {{destination}} eq 443" },
  ];
  for (const template of automationTemplates) {
    await prisma.automationTemplate.upsert({
      where: { organizationId_name: { organizationId: organization.id, name: template.name } },
      update: { body: template.body, kind: template.kind, critical: kindIsCritical(template.kind), enabled: true },
      create: { organizationId: organization.id, name: template.name, kind: template.kind, body: template.body, critical: kindIsCritical(template.kind) },
    });
  }
  await prisma.automationPolicy.upsert({
    where: { organizationId: organization.id },
    update: { automaticCritical: false },
    create: { organizationId: organization.id, automaticCritical: false },
  });
  const routeTemplate = await prisma.automationTemplate.findFirstOrThrow({ where: { organizationId: organization.id, name: "Route statique" } });
  const coreInterface = await prisma.networkInterface.findFirst({ where: { deviceId: core.id }, orderBy: { name: "asc" } });
  const routeJob = {
    deviceId: core.id,
    templateId: routeTemplate.id,
    integration: "SIMULATION" as const,
    stage: "DESIRED" as const,
    desiredState: {
      hostname: core.hostname,
      managementIp: core.managementIp ?? "",
      role: core.role,
      managementInterface: coreInterface?.name ?? "",
      label: "Route prévue",
    },
    variables: { destination: "10.1.30.0", mask: "255.255.255.0", gateway: "10.0.0.3" },
    generatedConfig: null,
    diffText: null,
    changed: false,
    critical: false,
    authorization: "NONE" as const,
    dryRunReport: null,
    backupReport: null,
    executionReport: null,
    verificationReport: null,
    pushed: false,
    stored: false,
    verified: null,
    deviceQueried: false,
  };
  const existingRouteJob = await prisma.automationJob.findFirst({ where: { organizationId: organization.id, label: "Route prévue" } });
  if (existingRouteJob) {
    await prisma.automationJob.update({ where: { id: existingRouteJob.id }, data: routeJob });
  } else {
    await prisma.automationJob.create({ data: { organizationId: organization.id, label: "Route prévue", ...routeJob } });
  }

  const changeActor = await prisma.user.findUniqueOrThrow({ where: { email: "admin@netops.local" } });
  const rescue = "! Route de secours\nip route 10.9.1.0 255.255.255.0 10.0.0.3";
  await prisma.changeRequest.deleteMany({ where: { organizationId: organization.id, title: "Route de secours" } });
  await prisma.changeRequest.create({
    data: {
      organizationId: organization.id,
      deviceId: core.id,
      title: "Route de secours",
      important: true,
      integration: "SIMULATION",
      phase: "OPEN",
      proposedContent: rescue,
      logs: {
        create: {
          organizationId: organization.id,
          actorId: changeActor.id,
          deviceId: core.id,
          action: "request",
          oldConfig: "",
          newConfig: rescue,
          result: "RECORDED",
          sourceAddress: "127.0.0.1",
        },
      },
    },
  });

  await prisma.labPromotion.deleteMany({ where: { organizationId: organization.id } });
  await prisma.labFabric.deleteMany({ where: { organizationId: organization.id } });
  await prisma.labFabric.create({
    data: {
      organizationId: organization.id,
      siteId: lab.id,
      nodes: {
        create: [
          { role: "ROUTER", hostname: "lab-router", address: "10.255.0.1" },
          { role: "SWITCH", hostname: "lab-switch", address: "10.255.0.2" },
          { role: "FIREWALL", hostname: "lab-firewall", address: "10.255.0.3" },
          { role: "SERVER", hostname: "lab-server", address: "10.255.0.10" },
          { role: "CLIENT", hostname: "lab-client", address: "10.255.0.25" },
        ],
      },
      scenarios: {
        create: [
          { kind: "VLAN", label: "VLAN", ready: true, plan: "VLAN 100 LAB-DATA prévu sur lab-switch, isolé du site de production.", observation: "Scénario local au LAB. Aucun équipement de production n'est modifié. Ce n'est pas une mesure." },
          { kind: "DHCP", label: "DHCP", ready: true, plan: "Scope 10.255.0.100-10.255.0.200 prévu sur lab-server pour le VLAN 100.", observation: "Scénario local au LAB. Aucun équipement de production n'est modifié. Ce n'est pas une mesure." },
          { kind: "DNS", label: "DNS", ready: true, plan: "Zone lab.local prévue sur lab-server, avec lab-client.lab.local → 10.255.0.25.", observation: "Scénario local au LAB. Aucun équipement de production n'est modifié. Ce n'est pas une mesure." },
          { kind: "ROUTING", label: "Routing", ready: true, plan: "Route par défaut prévue sur lab-router via lab-firewall (10.255.0.3).", observation: "Scénario local au LAB. Aucun équipement de production n'est modifié. Ce n'est pas une mesure." },
          { kind: "ACL", label: "ACL", ready: true, plan: "Politique prévue : client du VLAN 100 autorisé vers lab-server:80, le reste refusé.", observation: "Scénario local au LAB. Aucun équipement de production n'est modifié. Ce n'est pas une mesure." },
          { kind: "CONNECTIVITY", label: "Connectivity", ready: true, plan: "Chemin prévu : lab-client → lab-switch → lab-router → lab-firewall → lab-server.", observation: "Scénario local au LAB. Aucun équipement de production n'est modifié. Ce n'est pas une mesure." },
        ],
      },
    },
  });

  const superAdmin = await prisma.user.findUniqueOrThrow({ where: { email: "superadmin@netops.local" } });
  const alreadySeeded = await prisma.auditEvent.findFirst({
    where: { action: "seed.bootstrap", organizationId: organization.id },
  });
  if (!alreadySeeded) {
    await prisma.auditEvent.create({
      data: {
        actorId: superAdmin.id,
        organizationId: organization.id,
        action: "seed.bootstrap",
        resourceType: "Organization",
        resourceId: organization.id,
        metadata: { slug: organization.slug },
      },
    });
  }

  console.log("Seed terminé.");
  console.log("Mot de passe commun :", DEMO_PASSWORD);
  for (const account of USERS) {
    console.log(`- ${account.email} (${account.role ?? "SUPER_ADMIN"})`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
