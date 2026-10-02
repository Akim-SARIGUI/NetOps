export const DISCOVERY_NOTICE = "Découverte simulée. Aucun équipement réel n'est interrogé.";
export const CONNECTOR_NOTICE = "Les connecteurs ICMP, ARP, SNMP, LLDP, CDP et SSH sont préparés. Aucun n'est disponible.";

export const CONNECTORS = ["SIMULATION", "ICMP", "ARP", "SNMP", "LLDP", "CDP", "SSH"] as const;
export const VERDICTS = ["DISCOVERED", "UNKNOWN", "MATCHED", "CONFLICT"] as const;
export const RUN_STATUSES = ["DISCOVERY", "REVIEW", "APPROVED", "IMPORTED"] as const;
export const DECISIONS = ["ACCEPTED", "REJECTED"] as const;

export type ConnectorId = (typeof CONNECTORS)[number];
export type Verdict = (typeof VERDICTS)[number];
export type RunStatus = (typeof RUN_STATUSES)[number];
export type Decision = (typeof DECISIONS)[number];
export type DeviceRoleName = "ROUTER" | "SWITCH" | "FIREWALL" | "SERVER" | "ACCESS_POINT" | "CLIENT";

export type InterfaceObservation = { name: string; macAddress: string | null; status: string };
export type PortObservation = { name: string; mode: string | null; vlan: number | null };
export type VlanObservation = { vid: number; name: string | null };
export type NeighborObservation = { hostname: string; localPort: string; remotePort: string | null };

export type Observation = {
  hostname: string | null;
  ipAddress: string | null;
  macAddress: string | null;
  role: DeviceRoleName | null;
  interfaces: InterfaceObservation[];
  ports: PortObservation[];
  vlans: VlanObservation[];
  neighbors: NeighborObservation[];
};

export type InventoryRecord = {
  id: string;
  hostname: string;
  managementIp: string | null;
  macAddresses: string[];
};

export type ClassifiedObservation = Observation & {
  verdict: Verdict;
  matchedDeviceId: string | null;
  conflictReason: string | null;
  simulated: true;
};

export type ProbeResult = { connector: ConnectorId; available: boolean; message: string };

const UNAVAILABLE: Record<Exclude<ConnectorId, "SIMULATION">, string> = {
  ICMP: "Le connecteur ICMP n'est pas intégré.",
  ARP: "Le connecteur ARP n'est pas intégré.",
  SNMP: "Le connecteur SNMP n'est pas intégré.",
  LLDP: "Le connecteur LLDP n'est pas intégré.",
  CDP: "Le connecteur CDP n'est pas intégré.",
  SSH: "Le connecteur SSH n'est pas intégré.",
};

const DISCOVERED_SWITCH: Observation = {
  hostname: "sw-nouveau",
  ipAddress: "10.9.0.10",
  macAddress: "02:00:00:00:00:10",
  role: "SWITCH",
  interfaces: [{ name: "Gi1/0/1", macAddress: "02:00:00:00:00:11", status: "UP" }],
  ports: [{ name: "Gi1/0/1", mode: "ACCESS", vlan: 10 }],
  vlans: [{ vid: 10, name: "Utilisateurs" }],
  neighbors: [{ hostname: "core-paris", localPort: "Gi1/0/1", remotePort: "Gi0/1" }],
};

const UNKNOWN_HOST: Observation = {
  hostname: null,
  ipAddress: "10.9.0.50",
  macAddress: null,
  role: null,
  interfaces: [],
  ports: [],
  vlans: [],
  neighbors: [],
};

export function connectorCatalog(): ProbeResult[] {
  return CONNECTORS.map((connector) => probe(connector));
}

export function probe(connector: ConnectorId): ProbeResult {
  if (connector === "SIMULATION") return { connector, available: true, message: DISCOVERY_NOTICE };
  return { connector, available: false, message: UNAVAILABLE[connector] };
}

export function classify(observation: Observation, inventory: readonly InventoryRecord[]): Pick<ClassifiedObservation, "verdict" | "matchedDeviceId" | "conflictReason"> {
  const hostname = observation.hostname?.trim() || null;
  const ipAddress = observation.ipAddress?.trim() || null;
  const macAddress = observation.macAddress?.trim().toLowerCase() || null;
  if (!hostname || !ipAddress) {
    return { verdict: "UNKNOWN", matchedDeviceId: null, conflictReason: "Nom d'hôte ou adresse IP absent" };
  }

  const byIp = inventory.find((item) => item.managementIp === ipAddress);
  const byName = inventory.find((item) => item.hostname === hostname);
  const byMac = macAddress ? inventory.find((item) => item.macAddresses.some((value) => value.toLowerCase() === macAddress)) : undefined;
  const distinct = new Set([byIp?.id, byName?.id, byMac?.id].filter((id): id is string => Boolean(id)));
  if (distinct.size > 1) {
    return { verdict: "CONFLICT", matchedDeviceId: null, conflictReason: "L'adresse, le nom et l'adresse MAC ne désignent pas le même équipement" };
  }
  if (byIp && byIp.hostname !== hostname) {
    return { verdict: "CONFLICT", matchedDeviceId: byIp.id, conflictReason: `L'adresse ${ipAddress} appartient déjà à ${byIp.hostname}` };
  }
  if (byName && byName.managementIp && byName.managementIp !== ipAddress) {
    return { verdict: "CONFLICT", matchedDeviceId: byName.id, conflictReason: `${hostname} a déjà l'adresse ${byName.managementIp}` };
  }
  if (byMac && byMac.hostname !== hostname) {
    return { verdict: "CONFLICT", matchedDeviceId: byMac.id, conflictReason: `L'adresse MAC ${macAddress} appartient déjà à ${byMac.hostname}` };
  }
  const match = byIp ?? byName ?? byMac;
  if (match) return { verdict: "MATCHED", matchedDeviceId: match.id, conflictReason: null };
  return { verdict: "DISCOVERED", matchedDeviceId: null, conflictReason: null };
}

export function decisionError(verdict: Verdict, decision: Decision) {
  if (decision === "REJECTED") return null;
  if (verdict === "CONFLICT") return "Un conflit ne peut pas être accepté. Refusez-le : l'inventaire n'est pas modifié.";
  if (verdict === "UNKNOWN") return "Une observation inconnue ne peut pas être acceptée. Refusez-la.";
  return null;
}

export function simulateObservations(inventory: readonly InventoryRecord[]): ClassifiedObservation[] {
  const known = inventory.find((item) => item.hostname === "core-paris") ?? inventory.find((item) => item.hostname && item.managementIp);
  const observations: Observation[] = [];
  if (known?.hostname && known.managementIp) {
    observations.push({
      hostname: known.hostname,
      ipAddress: known.managementIp,
      macAddress: known.macAddresses[0] ?? null,
      role: "ROUTER",
      interfaces: [],
      ports: [],
      vlans: [],
      neighbors: [],
    });
  }
  observations.push(DISCOVERED_SWITCH, UNKNOWN_HOST, {
    hostname: "core-inconnu",
    ipAddress: known?.managementIp ?? "10.0.0.1",
    macAddress: "02:00:00:00:00:99",
    role: "ROUTER",
    interfaces: [],
    ports: [],
    vlans: [],
    neighbors: [],
  });
  return observations.map((observation) => ({
    ...observation,
    ...classify(observation, inventory),
    simulated: true as const,
  }));
}
