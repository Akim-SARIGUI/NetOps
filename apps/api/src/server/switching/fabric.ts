import { containsAddress, parseAddress, parsePrefix, placement, rangesOverlap } from "../ipam/address";

export type FabricAddress = {
  address: string;
  deviceSiteId: string | null;
};

export type FabricSubnet = {
  cidr: string;
  gateway: string | null;
  gatewayBound: boolean;
  addresses: FabricAddress[];
};

export type FabricPort = {
  name: string;
  mode: "ACCESS" | "TRUNK";
  switchHostname: string;
  switchSiteId: string;
  connectedHostname: string | null;
  connectedSiteId: string | null;
  connectedAddresses: string[];
};

export type FabricIssue = {
  code: string;
  message: string;
};

export function fabricIssues(
  vlan: { vid: number; name: string; siteId: string; status: string },
  subnets: FabricSubnet[],
  ports: FabricPort[],
  siblings: { name: string; cidr: string }[],
): FabricIssue[] {
  const issues: FabricIssue[] = [];
  if (vlan.status === "ACTIVE" && subnets.length === 0) {
    issues.push({ code: "VLAN_WITHOUT_SUBNET", message: `Le VLAN ${vlan.vid} ${vlan.name} n'a pas de sous-réseau` });
  }

  const prefixes = subnets.flatMap((subnet) => {
    const parsed = parsePrefix(subnet.cidr);
    return parsed.ok ? [parsed.prefix] : [];
  });

  for (const subnet of subnets) {
    const parsed = parsePrefix(subnet.cidr);
    if (!parsed.ok) {
      issues.push({ code: "INVALID_SUBNET", message: `Le préfixe ${subnet.cidr} est invalide` });
      continue;
    }
    if (!subnet.gateway) {
      issues.push({ code: "GATEWAY_MISSING", message: `Le sous-réseau ${subnet.cidr} n'a pas de passerelle` });
    } else {
      const gateway = parseAddress(subnet.gateway);
      if (!gateway || placement(parsed.prefix, gateway) !== "OK") {
        issues.push({ code: "GATEWAY_OUTSIDE", message: `La passerelle ${subnet.gateway} n'appartient pas à ${subnet.cidr}` });
      } else if (!subnet.gatewayBound) {
        issues.push({ code: "GATEWAY_UNBOUND", message: `La passerelle ${subnet.gateway} n'est portée par aucune interface` });
      }
    }
    for (const address of subnet.addresses) {
      if (address.deviceSiteId && address.deviceSiteId !== vlan.siteId) {
        issues.push({
          code: "SITE_MISMATCH",
          message: `L'adresse ${address.address} est attribuée à un équipement d'un autre site`,
        });
      }
    }
    for (const sibling of siblings) {
      const other = parsePrefix(sibling.cidr);
      if (other.ok && other.prefix.family === parsed.prefix.family && rangesOverlap(parsed.prefix, other.prefix)) {
        issues.push({ code: "OVERLAP", message: `${subnet.cidr} chevauche ${sibling.name} (${other.prefix.cidr})` });
      }
    }
  }

  for (const port of ports) {
    if (port.switchSiteId !== vlan.siteId) {
      issues.push({
        code: "SITE_MISMATCH",
        message: `Le commutateur ${port.switchHostname} qui porte ${port.name} n'est pas sur le site du VLAN ${vlan.vid}`,
      });
    }
    if (port.connectedSiteId && port.connectedSiteId !== vlan.siteId) {
      issues.push({
        code: "SITE_MISMATCH",
        message: `${port.connectedHostname} raccordé à ${port.name} n'est pas sur le site du VLAN`,
      });
    }
    if (port.mode === "ACCESS" && port.connectedHostname && prefixes.length > 0) {
      const inside = port.connectedAddresses.some((value) => {
        const address = parseAddress(value);
        return Boolean(address && prefixes.some((prefix) => containsAddress(prefix, address)));
      });
      if (!inside) {
        issues.push({
          code: "CONNECTED_OFF_SUBNET",
          message: `${port.connectedHostname} sur ${port.switchHostname} ${port.name} n'a pas d'adresse dans le sous-réseau du VLAN ${vlan.vid}`,
        });
      }
    }
  }

  if (vlan.status === "ACTIVE" && subnets.length > 0 && ports.length === 0) {
    issues.push({ code: "VLAN_NOT_SWITCHED", message: `Aucun port de commutateur ne transporte le VLAN ${vlan.vid}` });
  }

  return issues;
}
