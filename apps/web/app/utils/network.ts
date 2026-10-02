import type { DeviceRole, DeviceStatus, Duplex, InterfaceStatus, PoeStatus, PortMode, PortStatus, SecurityZone, VlanRole, VlanStatus } from "~/types/api";

export const roleLabels: Record<DeviceRole, string> = {
  ROUTER: "Routeur",
  SWITCH: "Commutateur",
  FIREWALL: "Pare-feu",
  SERVER: "Serveur",
  ACCESS_POINT: "Point d'accès",
  CLIENT: "Client",
};

export const statusLabels: Record<DeviceStatus, string> = {
  PLANNED: "Planifié",
  ACTIVE: "Actif",
  MAINTENANCE: "Maintenance",
  OFFLINE: "Hors ligne",
  DECOMMISSIONED: "Décommissionné",
};

export const interfaceStatusLabels: Record<InterfaceStatus, string> = {
  UP: "Actif",
  DOWN: "Inactif",
  ADMIN_DOWN: "Coupé",
};

export const duplexLabels: Record<Duplex, string> = {
  AUTO: "Auto",
  FULL: "Full",
  HALF: "Half",
};

export const vlanRoleLabels: Record<VlanRole, string> = {
  DATA: "Données",
  VOICE: "Voix",
  MANAGEMENT: "Administration",
  GUEST: "Invités",
  SERVER: "Serveurs",
  TRANSIT: "Transit",
  NATIVE: "Natif",
};

export const securityZoneLabels: Record<SecurityZone, string> = {
  TRUST: "Confiance",
  UNTRUST: "Non confiance",
  DMZ: "DMZ",
  GUEST: "Invités",
  MANAGEMENT: "Administration",
  INTERNAL: "Interne",
};

export const vlanStatusLabels: Record<VlanStatus, string> = {
  ACTIVE: "Actif",
  PLANNED: "Planifié",
  RESERVED: "Réservé",
  DEPRECATED: "Déprécié",
};

export const portModeLabels: Record<PortMode, string> = {
  ACCESS: "Access",
  TRUNK: "Trunk",
};

export const portStatusLabels: Record<PortStatus, string> = {
  UP: "Actif",
  DOWN: "Inactif",
  ADMIN_DOWN: "Coupé",
  ERR_DISABLED: "Err-disabled",
};

export const poeLabels: Record<PoeStatus, string> = {
  OFF: "Arrêt",
  ON: "Actif",
  FAULT: "Défaut",
};

export function portAssignment(port: { mode: PortMode; accessVlan: { vid: number } | null; allowedVlans: { vid: number }[] }) {
  if (port.mode === "TRUNK") {
    const vids = port.allowedVlans.map((vlan) => vlan.vid).join(", ");
    return vids ? `Trunk ${vids}` : "Trunk";
  }
  return port.accessVlan ? `VLAN ${port.accessVlan.vid}` : "Access";
}

export function locationLabel(device: {
  site?: { name: string } | null;
  building?: { name: string } | null;
  room?: { name: string } | null;
  rack?: { name: string } | null;
}) {
  return [device.site?.name, device.building?.name, device.room?.name, device.rack?.name].filter(Boolean).join(" / ");
}
