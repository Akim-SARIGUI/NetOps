export type Permission =
  | "org:create"
  | "org:update"
  | "org:delete"
  | "hierarchy:read"
  | "hierarchy:write"
  | "hierarchy:delete"
  | "members:read"
  | "members:write"
  | "audit:read"
  | "inventory:read"
  | "inventory:write"
  | "inventory:delete";

export type RoleName =
  | "SUPER_ADMIN"
  | "NETWORK_ADMIN"
  | "NETWORK_OPERATOR"
  | "AUDITOR"
  | "VIEWER";

export type Session = {
  user: {
    id: string;
    email: string;
    name: string;
    isSuperAdmin: boolean;
  };
  platformPermissions: Permission[];
  memberships: Array<{
    organization: { id: string; name: string; slug: string };
    role: RoleName;
    permissions: Permission[];
  }>;
};

export type Organization = {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
  counts?: { sites: number; members: number };
};

export type Site = {
  id: string;
  organizationId: string;
  name: string;
  code: string;
  environment: "PRODUCTION" | "STAGING" | "LAB" | "DEV";
  address: string | null;
  createdAt: string;
  updatedAt: string;
  counts?: { buildings: number };
  organization?: { id: string; name: string; slug: string };
};

export type Building = {
  id: string;
  siteId: string;
  name: string;
  code: string;
  counts?: { rooms: number };
  site?: { id: string; name: string; code: string; organizationId: string };
  organization?: { id: string; name: string; slug: string };
};

export type Room = {
  id: string;
  buildingId: string;
  name: string;
  code: string;
  counts?: { racks: number };
  building?: { id: string; name: string; code: string };
  site?: { id: string; name: string; code: string; organizationId: string };
  organization?: { id: string; name: string; slug: string };
};

export type Rack = {
  id: string;
  roomId: string;
  name: string;
  code: string;
  heightU: number;
  room?: { id: string; name: string; code: string };
  building?: { id: string; name: string; code: string };
  site?: { id: string; name: string; code: string; organizationId: string };
  organization?: { id: string; name: string; slug: string };
};

export type Member = {
  user: { id: string; email: string; name: string; isActive: boolean };
  role: RoleName;
  createdAt: string;
};

export type AuditEvent = {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  metadata: unknown;
  createdAt: string;
  actor: { id: string; email: string; name: string } | null;
};

export type DeviceRole = "ROUTER" | "SWITCH" | "FIREWALL" | "SERVER" | "ACCESS_POINT" | "CLIENT";
export type DeviceStatus = "PLANNED" | "ACTIVE" | "MAINTENANCE" | "OFFLINE" | "DECOMMISSIONED";
export type InterfaceStatus = "UP" | "DOWN" | "ADMIN_DOWN";
export type Duplex = "AUTO" | "FULL" | "HALF";

export type PlaceRef = { id: string; name: string; code: string };

export type Device = {
  id: string;
  organizationId: string;
  role: DeviceRole;
  hostname: string;
  managementIp: string | null;
  vendor: string | null;
  model: string | null;
  os: string | null;
  osVersion: string | null;
  serialNumber: string | null;
  status: DeviceStatus;
  description: string | null;
  site: PlaceRef;
  building: PlaceRef | null;
  room: PlaceRef | null;
  rack: PlaceRef | null;
  counts?: { interfaces: number };
  organization?: { id: string; name: string; slug: string };
  interfaces?: NetworkInterface[];
};

export type NetworkInterface = {
  id: string;
  deviceId: string;
  name: string;
  ipAddress: string | null;
  macAddress: string | null;
  speedMbps: number | null;
  duplex: Duplex | null;
  status: InterfaceStatus;
  description: string | null;
};

export type InventorySummary = {
  devices: number;
  interfaces: number;
  byRole: Record<DeviceRole, number>;
  byStatus: Record<DeviceStatus, number>;
};

export type ListResponse<T> = { data: T[] };

export type IpFamily = "IPV4" | "IPV6";
export type IpAddressRole = "GATEWAY" | "ALLOCATED" | "RESERVED";

export type PrefixStats = {
  family: IpFamily;
  network: string;
  netmask: string;
  prefix: number;
  cidr: string;
  firstUsable: string | null;
  lastUsable: string | null;
  broadcast: string | null;
  total: string;
  usable: string;
  used: string;
  available: string;
  utilization: number;
};

export type IpamSubnet = {
  id: string;
  name: string;
  description: string | null;
  cidr: string;
  family: IpFamily;
  vlan: { id: string; vid: number; name: string };
  stats: PrefixStats;
};

export type IpamNetwork = {
  id: string;
  name: string;
  description: string | null;
  cidr: string;
  family: IpFamily;
  site: { id: string; name: string; code: string };
  stats: PrefixStats;
  subnets: IpamSubnet[];
};

export type IpamOverview = {
  networks: IpamNetwork[];
  orphans: Array<{ address: string | null; message: string; interface: { id: string; name: string; device: { id: string; hostname: string } } }>;
};

export type IpAllocation = {
  id: string;
  address: string;
  role: IpAddressRole;
  description: string | null;
  interface: { id: string; name: string; device: { id: string; hostname: string } } | null;
};

export type SubnetDetail = {
  id: string;
  name: string;
  description: string | null;
  cidr: string;
  family: IpFamily;
  network: { id: string; name: string; cidr: string };
  site: { id: string; name: string; code: string };
  organizationId: string;
  vlan: { id: string; vid: number; name: string };
  gateway: IpAllocation | null;
  stats: PrefixStats;
  grid: Array<{ address: string; kind: "free" | "network" | "broadcast" | "gateway" | "allocated" | "reserved" }> | null;
  addresses: IpAllocation[];
  issues: Array<{ code: string; message: string }>;
};

export type VlsmPlan = {
  feasible: boolean;
  message: string | null;
  family: IpFamily | null;
  subnets: Array<{
    name: string;
    cidr: string;
    prefix: number;
    network: string;
    netmask: string;
    firstUsable: string | null;
    lastUsable: string | null;
    broadcast: string | null;
    total: string;
    usable: string;
  }>;
};

export type VlanRole = "DATA" | "VOICE" | "MANAGEMENT" | "GUEST" | "SERVER" | "TRANSIT" | "NATIVE";
export type SecurityZone = "TRUST" | "UNTRUST" | "DMZ" | "GUEST" | "MANAGEMENT" | "INTERNAL";
export type VlanStatus = "ACTIVE" | "PLANNED" | "RESERVED" | "DEPRECATED";
export type PortMode = "ACCESS" | "TRUNK";
export type PortStatus = "UP" | "DOWN" | "ADMIN_DOWN" | "ERR_DISABLED";
export type PoeStatus = "OFF" | "ON" | "FAULT";

export type Vlan = {
  id: string;
  siteId: string;
  vid: number;
  name: string;
  description: string | null;
  role: VlanRole;
  securityZone: SecurityZone;
  status: VlanStatus;
  usage?: number;
  site?: { id: string; name: string; code: string };
  subnets?: Array<{ id: string; cidr: string; gateway: string | null }>;
};

export type VlanRef = { id: string; vid: number; name: string; status?: VlanStatus };

export type VlanFabric = Omit<Vlan, "subnets" | "site"> & {
  organizationId: string;
  site: { id: string; name: string; code: string; organizationId: string };
  subnets: Array<{
    id: string;
    name: string;
    cidr: string;
    gateway: { address: string; interface: { id: string; name: string; device: { id: string; hostname: string } } | null } | null;
    stats: PrefixStats | null;
    addresses: Array<{
      id: string;
      address: string;
      role: IpAddressRole;
      description: string | null;
      device: { id: string; hostname: string; siteId: string; role: string } | null;
      interfaceName: string | null;
    }>;
  }>;
  switches: Array<{ id: string; hostname: string; siteId: string; role: string }>;
  ports: Array<{
    id: string;
    name: string;
    mode: PortMode;
    status: PortStatus;
    switch: { id: string; hostname: string };
    connectedDevice: { id: string; hostname: string; role: string } | null;
  }>;
  equipment: Array<{ id: string; hostname: string; role: string; via: string }>;
  issues: Array<{ code: string; message: string }>;
};

export type SwitchPort = {
  id: string;
  deviceId: string;
  name: string;
  status: PortStatus;
  mode: PortMode;
  speedMbps: number | null;
  duplex: Duplex | null;
  description: string | null;
  macAddress: string | null;
  poe: PoeStatus;
  accessVlan: VlanRef | null;
  nativeVlan: VlanRef | null;
  allowedVlans: VlanRef[];
  connectedDevice: { id: string; hostname: string; role: DeviceRole } | null;
};

export type SwitchingIssue = { code: string; message: string; portId?: string; vlanId?: string };

export type SwitchingView = {
  device: { id: string; hostname: string; site: { id: string; name: string; code: string } };
  tree: string;
  ports: SwitchPort[];
  vlans: Vlan[];
  inconsistencies: SwitchingIssue[];
};

export type DhcpServerStatus = "PLANNED" | "ACTIVE" | "DISABLED";
export type DhcpLeaseState = "ACTIVE" | "EXPIRED" | "RELEASED";

export type DhcpIssue = { code: string; message: string };

export type DhcpScopeSummary = {
  id: string;
  enabled: boolean;
  gateway: string;
  dnsServers: string[];
  domain: string | null;
  leaseSeconds: number;
  server: { id: string; name: string; address: string | null; status: DhcpServerStatus };
  subnet: { id: string; name: string; cidr: string };
  vlan: { id: string; vid: number; name: string };
  site: { id: string; name: string; code: string };
  pools: Array<{ id: string; start: string; end: string }>;
  stats: { capacity: string; used: string; available: string; utilization: number; exhausted: boolean; activeLeases: number };
  issues: DhcpIssue[];
};

export type DhcpOverview = {
  mode: "SIMULATION";
  notice: string;
  organizationId: string;
  totals: { scopes: number; servers: number; activeLeases: number; capacity: string; used: string; available: string; utilization: number };
  alerts: Array<DhcpIssue & { scopeId: string; cidr: string; vlan: { id: string; vid: number; name: string } }>;
  servers: Array<{
    id: string;
    name: string;
    description: string | null;
    address: string | null;
    status: DhcpServerStatus;
    mode: "SIMULATION";
    site: { id: string; name: string; code: string };
    device: { id: string; hostname: string } | null;
    counts: { scopes: number; relays: number };
  }>;
  scopes: DhcpScopeSummary[];
  leases: Array<{
    id: string;
    address: string;
    macAddress: string;
    hostname: string | null;
    state: DhcpLeaseState;
    origin: "SIMULATION";
    scopeId: string;
    cidr: string;
    vlan: { id: string; vid: number; name: string };
  }>;
  relays: Array<{
    id: string;
    helperAddress: string;
    description: string | null;
    server: { id: string; name: string; address: string | null };
    interface: { id: string; name: string; device: { id: string; hostname: string } } | null;
    subnet: { id: string; cidr: string; vlan: { id: string; vid: number; name: string } };
  }>;
};

export type DhcpScopeDetail = DhcpScopeSummary & {
  description: string | null;
  mode: "SIMULATION";
  organizationId: string;
  exclusions: Array<{ id: string; start: string; end: string; reason: string | null }>;
  reservations: Array<{ id: string; address: string; macAddress: string; hostname: string | null; description: string | null }>;
  leases: Array<{
    id: string;
    address: string;
    macAddress: string;
    hostname: string | null;
    state: DhcpLeaseState;
    origin: "SIMULATION";
    startsAt: string;
    expiresAt: string;
  }>;
  relays: Array<{
    id: string;
    helperAddress: string;
    server: { id: string; name: string; address: string | null };
    interface: { id: string; name: string; device: { hostname: string } } | null;
  }>;
};

export type DnsRecordType = "A" | "AAAA" | "CNAME" | "MX" | "NS" | "PTR" | "TXT" | "SRV";
export type DnsZoneKind = "FORWARD" | "REVERSE";
export type DnsServerStatus = "PLANNED" | "ACTIVE" | "DISABLED";

export type DnsLink = {
  address: string;
  device: { id: string; hostname: string } | null;
  subnet: { id: string; cidr: string; name: string } | null;
  vlan: { id: string; vid: number; name: string } | null;
};

export type DnsRecordView = {
  id: string;
  name: string;
  fqdn: string;
  type: DnsRecordType;
  ttl: number | null;
  value: string;
  priority: number | null;
  weight: number | null;
  port: number | null;
  link: DnsLink | null;
};

export type DnsZoneSummary = {
  id: string;
  name: string;
  kind: DnsZoneKind;
  ttl: number;
  enabled: boolean;
  description: string | null;
  server: { id: string; name: string; address: string | null; status: DnsServerStatus };
  subnet: { id: string; name: string; cidr: string; vlan: { id: string; vid: number; name: string } } | null;
  records: DnsRecordView[];
  issues: Array<{ code: string; message: string }>;
};

export type DnsOverview = {
  mode: "LOCAL";
  notice: string;
  organizationId: string;
  totals: { servers: number; zones: number; records: number; alerts: number };
  alerts: Array<{ code: string; message: string; zoneId: string; zone: string }>;
  servers: Array<{
    id: string;
    name: string;
    description: string | null;
    address: string | null;
    status: DnsServerStatus;
    mode: "LOCAL";
    site: { id: string; name: string; code: string };
    device: { id: string; hostname: string } | null;
    counts: { zones: number };
  }>;
  zones: DnsZoneSummary[];
};

export type DnsZoneDetail = {
  mode: "LOCAL";
  notice: string;
  id: string;
  organizationId: string;
  name: string;
  kind: DnsZoneKind;
  ttl: number;
  enabled: boolean;
  description: string | null;
  server: { id: string; name: string; address: string | null; status: DnsServerStatus; device: { id: string; hostname: string } | null };
  subnet: { id: string; name: string; cidr: string; vlan: { id: string; vid: number; name: string } } | null;
  records: DnsRecordView[];
  chain: {
    zone: { name: string; kind: DnsZoneKind };
    records: Array<{ id: string; fqdn: string; type: DnsRecordType; value: string }>;
    addresses: DnsLink[];
    devices: Array<{ id: string; hostname: string }>;
    subnets: Array<{ id: string; cidr: string; name: string }>;
    vlans: Array<{ id: string; vid: number; name: string }>;
  };
  issues: Array<{ code: string; message: string }>;
  history: Array<{ id: string; action: string; summary: string; createdAt: string; actor: { id: string; name: string } | null }>;
};

export type RouteProtocol = "CONNECTED" | "STATIC" | "DEFAULT" | "OSPF";
export type Layer3Kind = "PHYSICAL" | "SVI" | "SUBINTERFACE";

export type RoutingIssue = { code: string; message: string };

export type RoutingRoute = {
  id: string;
  derived: boolean;
  destination: string;
  prefix: number;
  cidr: string;
  gateway: string | null;
  interface: { id: string; name: string; kind: Layer3Kind } | null;
  metric: number;
  protocol: RouteProtocol;
  device: { id: string; hostname: string };
  status: string;
  issues: RoutingIssue[];
};

export type RoutingPath = {
  fromVlan: { id: string; vid: number; name: string };
  gateway: string;
  fromInterface: { name: string; kind: Layer3Kind };
  router: { id: string; hostname: string };
  toVlan: { id: string; vid: number; name: string };
  toGateway: string;
  toInterface: { name: string; kind: Layer3Kind };
};

export type RoutingOverview = {
  mode: "PLANNED";
  notice: string;
  ospfNotice: string;
  organizationId: string;
  totals: { interfaces: number; routes: number; paths: number; alerts: number };
  paths: RoutingPath[];
  devices: Array<{ id: string; hostname: string; siteId: string; organizationId: string; routes: number }>;
  interfaces: Array<{
    id: string;
    name: string;
    kind: Layer3Kind;
    address: string;
    status: string;
    device: { id: string; hostname: string };
    vlan: { id: string; vid: number; name: string } | null;
    subnet: { id: string; cidr: string };
    parent: { id: string; name: string; ipAddress: string | null } | null;
  }>;
  routes: RoutingRoute[];
  ospf: Array<{
    id: string;
    processId: number;
    routerId: string;
    status: string;
    device: { id: string; hostname: string };
    areas: Array<{ id: string; areaId: string; interfaces: Array<{ id: string; name: string }> }>;
    notice: string;
  }>;
};

export type DeviceRoutingTable = {
  mode: "PLANNED";
  notice: string;
  ospfNotice: string;
  organizationId: string;
  device: { id: string; hostname: string; site: { id: string; name: string; organizationId: string } };
  interfaces: Array<{ id: string; name: string; kind: Layer3Kind; address: string; vlan: { id: string; vid: number; name: string } | null; subnet: { cidr: string } }>;
  routes: RoutingRoute[];
  ospf: {
    id: string;
    processId: number;
    routerId: string;
    status: string;
    areas: Array<{ id: string; areaId: string; interfaces: Array<{ id: string; name: string }> }>;
    notice: string;
  } | null;
};

export type DnsResolution = {
  mode: "LOCAL";
  notice: string;
  found: boolean;
  message: string;
  query: { name: string; type: DnsRecordType | null };
  trace: Array<{ name: string; type: DnsRecordType; rdata: string; ttl: number | null }>;
  answers: Array<{ name: string; type: DnsRecordType; rdata: string; ttl: number | null; link: DnsLink | null }>;
};

export type PolicyAction = "ALLOW" | "DENY";
export type PolicyProtocol = "ANY" | "TCP" | "UDP" | "ICMP";
export type PolicyIssue = { code: "CONTRADICTION" | "IMPOSSIBLE" | "DUPLICATE" | "PRIORITY"; message: string };

export type FlowRuleView = {
  id: string;
  priority: number;
  source: string;
  destination: string;
  protocol: PolicyProtocol;
  sourcePort: string | null;
  destinationPort: string | null;
  action: PolicyAction;
  logging: boolean;
  enabled: boolean;
  issues: PolicyIssue[];
};

export type FirewallOverview = {
  mode: "PLANNED";
  notice: string;
  organizationId: string;
  totals: { zones: number; flows: number; acls: number; alerts: number };
  zones: Array<{ id: string; name: string; description: string | null; vlans: Array<{ id: string; vid: number; name: string; siteId: string }> }>;
  flows: FlowRuleView[];
  acls: Array<{
    id: string;
    name: string;
    description: string | null;
    status: string;
    device: { id: string; hostname: string; siteId: string } | null;
    rules: FlowRuleView[];
  }>;
  matrix: Array<{
    source: { id: string; vid: number; name: string; zone: string | null };
    destination: { id: string; vid: number; name: string; zone: string | null };
    action: PolicyAction | null;
    implicit: boolean;
    priority: number | null;
  }>;
};

export type TopologyNode = {
  id: string;
  role: string;
  label: string;
  kind: "DEVICE" | "INTERNET";
  simulated: boolean;
  siteId: string;
  x: number;
  y: number;
  placed: boolean;
};

export type TopologyLink = {
  id: string;
  derived: boolean;
  origin: "INVENTORY" | "MANUAL" | "SIMULATION";
  simulated: boolean;
  sourceId: string;
  targetId: string;
  sourcePort: string | null;
  targetPort: string | null;
  speedMbps: number | null;
  status: string;
  vlan: { id: string; vid: number; name: string } | null;
  trafficBps: number | null;
};

export type TopologyOverview = {
  mode: "INVENTORY";
  notice: string;
  discoveryNotice: string;
  organizationId: string;
  nodes: TopologyNode[];
  links: TopologyLink[];
  discoveries: Array<{ id: string; protocol: "LLDP" | "CDP"; status: "PLANNED"; notice: string }>;
};

export type MonitoringTargetView = {
  id: string;
  mode: "SIMULATION" | "ICMP" | "SNMP";
  enabled: boolean;
  packetLossThreshold: number;
  status: "ONLINE" | "OFFLINE" | "UNKNOWN" | "DISABLED";
  simulated: boolean;
  collectorMessage: string | null;
  device: { id: string; hostname: string; role: string; siteId: string; inventoryStatus: string };
  metrics: {
    availability: number | null;
    cpu: number | null;
    ram: number | null;
    latencyMs: number | null;
    packetLossPercent: number | null;
    uptimeSeconds: number | null;
    errors: number | null;
    interfaces: Array<{ name: string; status: string; trafficBps: number | null; errors: number | null }>;
  };
  alerts: Array<{ code: string; severity: "critical"; message: string; interfaceName?: string }>;
};

export type MonitoringDashboard = {
  mode: "SIMULATION";
  notice: string;
  collectorNotice: string;
  organizationId: string;
  collectors: Array<{ id: "SIMULATION" | "ICMP" | "SNMP"; available: boolean; message: string }>;
  totals: {
    devices: number;
    online: number;
    offline: number;
    unknown: number;
    critical: number;
    trafficBps: number;
    latencyMs: number;
    packetLossPercent: number;
    vlanUtilization: number;
    ipUtilization: number;
    dhcpUtilization: number;
  };
  vlans: Array<{ id: string; vid: number; name: string; utilization: number }>;
  targets: MonitoringTargetView[];
  alerts: Array<{ code: string; severity: "critical"; message: string; device: string | null; interfaceName?: string }>;
};

export type DiscoveryConnectorId = "SIMULATION" | "ICMP" | "ARP" | "SNMP" | "LLDP" | "CDP" | "SSH";

export type DiscoveryFindingView = {
  id: string;
  position: number;
  verdict: "DISCOVERED" | "UNKNOWN" | "MATCHED" | "CONFLICT";
  decision: "PENDING" | "ACCEPTED" | "REJECTED";
  simulated: boolean;
  hostname: string | null;
  ipAddress: string | null;
  macAddress: string | null;
  role: string | null;
  interfaces: Array<{ name: string; macAddress: string | null; status: string }>;
  ports: Array<{ name: string; mode: string | null; vlan: number | null }>;
  vlans: Array<{ vid: number; name: string | null }>;
  neighbors: Array<{ hostname: string; localPort: string; remotePort: string | null }>;
  conflictReason: string | null;
  matchedDevice: { id: string; hostname: string } | null;
  importedDevice: { id: string; hostname: string; status: string } | null;
};

export type DiscoveryRunView = {
  id: string;
  label: string;
  status: "DISCOVERY" | "REVIEW" | "APPROVED" | "IMPORTED";
  simulated: boolean;
  notice: string;
  createdAt: string;
  site: { id: string; name: string; code: string; environment: string } | null;
  probes: Array<{ connector: DiscoveryConnectorId; available: boolean; message: string }>;
  findings: DiscoveryFindingView[];
};

export type DiscoveryOverview = {
  notice: string;
  connectorNotice: string;
  organizationId: string;
  connectors: Array<{ connector: DiscoveryConnectorId; available: boolean; message: string }>;
  runs: DiscoveryRunView[];
};

export type AutomationStage = "DESIRED" | "VALIDATION" | "GENERATE" | "DIFF" | "DRY_RUN" | "APPROVAL" | "BACKUP" | "DEPLOYMENT" | "VERIFICATION";

export type AutomationJobView = {
  id: string;
  label: string;
  integration: "SIMULATION" | "SSH" | "ANSIBLE" | "VENDOR_API" | "SNMP";
  stage: AutomationStage;
  critical: boolean;
  changed: boolean;
  authorization: "NONE" | "EXPLICIT" | "POLICY" | "WORKFLOW";
  pushed: boolean;
  stored: boolean;
  verified: boolean | null;
  deviceQueried: boolean;
  desiredState: Record<string, string>;
  variables: Record<string, string>;
  generatedConfig: string | null;
  diffText: string | null;
  dryRunReport: string | null;
  backupReport: string | null;
  executionReport: string | null;
  verificationReport: string | null;
  device: { id: string; hostname: string; status: string };
  template: { id: string; name: string; kind: string; critical: boolean };
  notice: string;
};

export type AutomationOverview = {
  notice: string;
  integrationNotice: string;
  organizationId: string;
  integrations: Array<{ id: AutomationJobView["integration"]; available: boolean; message: string }>;
  policy: { automaticCritical: boolean };
  templates: Array<{ id: string; name: string; kind: string; body: string; critical: boolean; enabled: boolean }>;
  jobs: AutomationJobView[];
};

export type ChangePhase = "OPEN" | "BACKED_UP" | "DEPLOYED" | "VERIFIED" | "FAILED" | "ROLLED_BACK" | "ROLLBACK_VERIFIED" | "INCIDENT";

export type ChangeRequestView = {
  id: string;
  title: string;
  important: boolean;
  integration: AutomationJobView["integration"];
  phase: ChangePhase;
  proposedContent: string;
  diffText: string | null;
  createdAt: string;
  device: { id: string; hostname: string };
  notice: string;
  backup: { id: string; deviceRead: boolean; notice: string; createdAt: string; version: { id: string; number: number; content: string; origin: string } } | null;
  versions: Array<{ id: string; number: number; origin: string; content: string; simulated: boolean; createdAt: string }>;
  deployments: Array<{ id: string; kind: string; result: string; pushed: boolean; report: string; createdAt: string }>;
  incident: { id: string; summary: string; createdAt: string } | null;
  logs: Array<{
    id: string;
    action: string;
    occurredAt: string;
    actor: { id: string; name: string };
    device: { id: string; hostname: string };
    oldConfig: string;
    newConfig: string;
    result: string;
    sourceAddress: string;
  }>;
};

export type ChangeOverview = {
  notice: string;
  organizationId: string;
  requests: ChangeRequestView[];
};

export type DiagnosticCheckView = {
  id?: string;
  rank?: number;
  step: string;
  label: string;
  available: boolean;
  fact: string;
  observation: string;
  possibleCause: string;
  recommendedCheck: string;
};

export type DiagnosticSessionView = {
  id: string;
  tool: string;
  mode: string;
  createdAt: string;
  device: { id: string; hostname: string };
  checks: DiagnosticCheckView[];
};

export type DiagnosticOverview = {
  notice: string;
  probeNotice: string;
  steps: Array<{ id: string; label: string }>;
  device: { id: string; hostname: string } | null;
  guide: DiagnosticCheckView[];
  sessions: DiagnosticSessionView[];
};

export type LabNodeView = { id: string; role: string; hostname: string; address: string };
export type LabScenarioView = {
  id: string;
  kind: string;
  label: string;
  ready: boolean;
  plan: string;
  observation: string;
};
export type LabPromotionView = {
  id: string;
  sourceEnvironment: string;
  targetEnvironment: string;
  phase: string;
  applied: boolean;
  pushed: boolean;
  confirmProduction: boolean;
  validatedAt: string | null;
  promotedAt: string | null;
  createdAt: string;
  configuration: string;
  notice: string;
  targetSite: { id: string; name: string; code: string; environment: string };
  sourcePromotion: { id: string; phase: string; targetEnvironment: string } | null;
};
export type LabFabricView = {
  id: string;
  notice: string;
  createdAt: string;
  site: { id: string; name: string; code: string; environment: string };
  nodes: LabNodeView[];
  scenarios: LabScenarioView[];
  promotions: LabPromotionView[];
};
export type LabOverview = {
  notice: string;
  promotionNotice: string;
  environments: Array<{ id: string; label: string; promotableFrom: string[]; promotableTo: string[] }>;
  sites: Array<{ id: string; name: string; code: string; environment: string }>;
  fabrics: LabFabricView[];
};

export type DocumentationSectionView = {
  id: string;
  title: string;
  description: string;
  rowCount: number;
  columns: string[];
  preview: Array<Record<string, string | number | boolean | null>>;
};

export type DocumentationOverview = {
  notice: string;
  generatedAt: string;
  organization: { id: string; name: string; slug: string };
  site: { id: string; name: string; code: string; environment: string } | null;
  formats: Array<"JSON" | "CSV" | "PDF">;
  relations: Array<{ from: string; to: string; rule: string }>;
  sections: DocumentationSectionView[];
};

export type DocumentationExport = {
  notice: string;
  format: "JSON" | "CSV" | "PDF";
  filename: string;
  mediaType: string;
  encoding: "utf8" | "base64";
  content: string;
  generatedAt: string;
};
