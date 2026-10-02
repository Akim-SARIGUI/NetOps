export type VlanRef = {
  id: string;
  vid: number;
  siteId: string;
  status: string;
  name: string;
};

export type PortSnapshot = {
  id: string;
  name: string;
  mode: "ACCESS" | "TRUNK";
  status: string;
  poe: string;
  macAddress: string | null;
  deviceId: string;
  deviceRole: string;
  deviceSiteId: string;
  deviceOrganizationId: string;
  accessVlan: VlanRef | null;
  nativeVlan: VlanRef | null;
  allowedVlans: VlanRef[];
  connectedDeviceId: string | null;
  connectedOrganizationId: string | null;
};

export type SwitchingIssue = {
  code: string;
  message: string;
  portId?: string;
  vlanId?: string;
};

const STRUCTURAL = new Set([
  "ACCESS_WITHOUT_VLAN",
  "ACCESS_HAS_NATIVE",
  "ACCESS_HAS_ALLOWED",
  "TRUNK_HAS_ACCESS",
  "TRUNK_WITHOUT_ALLOWED",
  "NATIVE_NOT_ALLOWED",
  "VLAN_SITE_MISMATCH",
  "DUPLICATE_ALLOWED",
  "CONNECTED_SELF",
  "CONNECTED_OTHER_ORG",
  "PORT_ON_NON_SWITCH",
]);

export function isStructuralIssue(code: string) {
  return STRUCTURAL.has(code);
}

export function portSummary(port: Pick<PortSnapshot, "mode" | "accessVlan">) {
  if (port.mode === "TRUNK") return "TRUNK";
  return port.accessVlan ? `VLAN ${port.accessVlan.vid}` : "VLAN ?";
}

export function renderSwitchTree(hostname: string, ports: PortSnapshot[]) {
  const sorted = [...ports].sort((left, right) =>
    left.name.localeCompare(right.name, "fr", { numeric: true }),
  );
  const lines = [hostname];
  sorted.forEach((port, index) => {
    const branch = index === sorted.length - 1 ? "└──" : "├──";
    lines.push(`${branch} ${port.name} → ${portSummary(port)}`);
  });
  return lines.join("\n");
}

function vlanSiteIssue(port: PortSnapshot, vlan: VlanRef | null, label: string): SwitchingIssue | null {
  if (!vlan || vlan.siteId === port.deviceSiteId) return null;
  return {
    code: "VLAN_SITE_MISMATCH",
    message: `${port.name} : le VLAN ${label} ${vlan.vid} n'appartient pas au site du commutateur`,
    portId: port.id,
    vlanId: vlan.id,
  };
}

export function issuesForPort(port: PortSnapshot): SwitchingIssue[] {
  const issues: SwitchingIssue[] = [];
  const push = (code: string, message: string, vlanId?: string) => {
    issues.push({ code, message: `${port.name} : ${message}`, portId: port.id, vlanId });
  };

  if (port.deviceRole !== "SWITCH") {
    push("PORT_ON_NON_SWITCH", "le port est porté par un équipement qui n'est pas un commutateur");
  }
  if (port.connectedDeviceId && port.connectedDeviceId === port.deviceId) {
    push("CONNECTED_SELF", "le port est connecté au commutateur lui-même");
  }
  if (port.connectedDeviceId && port.connectedOrganizationId && port.connectedOrganizationId !== port.deviceOrganizationId) {
    push("CONNECTED_OTHER_ORG", "l'équipement connecté appartient à une autre organisation");
  }

  const allowedIds = port.allowedVlans.map((vlan) => vlan.id);
  if (new Set(allowedIds).size !== allowedIds.length) {
    push("DUPLICATE_ALLOWED", "la liste des VLAN autorisés contient un doublon");
  }

  if (port.mode === "ACCESS") {
    if (!port.accessVlan) push("ACCESS_WITHOUT_VLAN", "un port access doit porter un seul VLAN");
    if (port.nativeVlan) push("ACCESS_HAS_NATIVE", "un port access ne porte pas de VLAN natif");
    if (port.allowedVlans.length > 0) push("ACCESS_HAS_ALLOWED", "un port access n'autorise pas une liste de VLAN");
  }

  if (port.mode === "TRUNK") {
    if (port.accessVlan) push("TRUNK_HAS_ACCESS", "un trunk ne porte pas de VLAN d'accès");
    if (port.allowedVlans.length === 0) push("TRUNK_WITHOUT_ALLOWED", "un trunk doit autoriser au moins un VLAN");
    if (port.nativeVlan && !allowedIds.includes(port.nativeVlan.id)) {
      push("NATIVE_NOT_ALLOWED", "le VLAN natif doit faire partie des VLAN autorisés", port.nativeVlan.id);
    }
  }

  const siteIssues = [
    vlanSiteIssue(port, port.accessVlan, "d'accès"),
    vlanSiteIssue(port, port.nativeVlan, "natif"),
    ...port.allowedVlans.map((vlan) => vlanSiteIssue(port, vlan, "autorisé")),
  ].filter((issue): issue is SwitchingIssue => issue !== null);
  issues.push(...siteIssues);

  const inactive = [port.accessVlan, port.nativeVlan, ...port.allowedVlans].filter(
    (vlan): vlan is VlanRef => vlan !== null && (vlan.status === "DEPRECATED" || vlan.status === "RESERVED"),
  );
  for (const vlan of inactive) {
    if (port.status === "UP") {
      push("VLAN_NOT_ACTIVE", `le VLAN ${vlan.vid} est ${vlan.status === "DEPRECATED" ? "déprécié" : "réservé"} alors que le port est actif`, vlan.id);
    }
  }

  if (port.poe === "FAULT") {
    push("POE_FAULT", "le PoE est en défaut");
  }

  return issues;
}

export function issuesForSwitch(ports: PortSnapshot[]): SwitchingIssue[] {
  const issues = ports.flatMap(issuesForPort);
  const byMac = new Map<string, PortSnapshot[]>();
  for (const port of ports) {
    if (!port.macAddress) continue;
    const list = byMac.get(port.macAddress) ?? [];
    list.push(port);
    byMac.set(port.macAddress, list);
  }
  for (const [mac, list] of byMac) {
    if (list.length < 2) continue;
    issues.push({
      code: "DUPLICATE_MAC",
      message: `L'adresse MAC ${mac} est présente sur ${list.map((port) => port.name).join(", ")}`,
      portId: list[0]?.id,
    });
  }
  return issues;
}
