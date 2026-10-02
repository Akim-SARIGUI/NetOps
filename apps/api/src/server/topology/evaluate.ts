export const TOPOLOGY_NOTICE = "Topologie issue de l'inventaire. Les pastilles Simulation ne sont pas des équipements réels.";
export const DISCOVERY_NOTICE = "Découverte LLDP/CDP préparée. Aucun voisin n'est lu sur les équipements.";

const LANE: Record<string, number> = {
  INTERNET: 80,
  FIREWALL: 280,
  ROUTER: 500,
  SWITCH: 740,
  SERVER: 980,
  ACCESS_POINT: 1220,
  CLIENT: 1460,
};

export type LayoutNode = { id: string; role: string; label: string };

export function layoutNodes<T extends LayoutNode>(nodes: T[], saved: ReadonlyMap<string, { x: number; y: number }>) {
  const counters = new Map<string, number>();
  return [...nodes]
    .sort((left, right) => left.role.localeCompare(right.role) || left.label.localeCompare(right.label))
    .map((node) => {
      const index = counters.get(node.role) ?? 0;
      counters.set(node.role, index + 1);
      const position = saved.get(node.id) ?? { x: LANE[node.role] ?? 1680, y: 90 + index * 150 };
      return { ...node, x: position.x, y: position.y, placed: saved.has(node.id) };
    });
}

export type InventoryPort = {
  id: string;
  name: string;
  status: string;
  mode: "ACCESS" | "TRUNK";
  speedMbps: number | null;
  device: { id: string; hostname: string };
  connectedDevice: { id: string; hostname: string; interfaces: Array<{ name: string }> } | null;
  accessVlan: { id: string; vid: number; name: string } | null;
  nativeVlan: { id: string; vid: number; name: string } | null;
};

export function inventoryLinks(ports: InventoryPort[]) {
  return ports.flatMap((port) => {
    if (!port.connectedDevice) return [];
    const interfaces = port.connectedDevice.interfaces;
    const vlan = port.mode === "ACCESS" ? port.accessVlan : port.nativeVlan;
    return [{
      id: `inventory:${port.id}`,
      derived: true as const,
      origin: "INVENTORY" as const,
      simulated: false,
      sourceId: port.device.id,
      targetId: port.connectedDevice.id,
      sourcePort: port.name,
      targetPort: interfaces.length === 1 ? interfaces[0]?.name ?? null : null,
      speedMbps: port.speedMbps,
      status: port.status,
      vlan,
      trafficBps: null as number | null,
    }];
  });
}

export function refuseDiscovery() {
  return { ok: false as const, status: 422 as const, message: "La découverte LLDP/CDP n'est pas exécutée. Aucun voisin n'est lu sur les équipements." };
}
