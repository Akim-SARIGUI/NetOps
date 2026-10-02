import { formatAddress, parsePrefix, type IpFamily, type ParsedPrefix } from "./address";

export type VlsmRequest = {
  name: string;
  hosts?: number;
  prefix?: number;
};

export type VlsmSubnet = {
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
};

export type VlsmPlan = {
  feasible: boolean;
  message: string | null;
  family: IpFamily | null;
  subnets: VlsmSubnet[];
};

export function planVlsm(cidr: string, requests: VlsmRequest[]): VlsmPlan {
  const parent = parsePrefix(cidr);
  if (!parent.ok) {
    return {
      feasible: false,
      family: null,
      subnets: [],
      message: parent.reason === "HOST_BITS" ? "Le préfixe parent doit être l'adresse réseau" : "Préfixe parent invalide",
    };
  }
  const ordered = [...requests].sort((left, right) => {
    const leftSize = blockSize(parent.prefix.family, requestPrefix(parent.prefix.family, left) ?? (parent.prefix.family === "IPV4" ? 32 : 128));
    const rightSize = blockSize(parent.prefix.family, requestPrefix(parent.prefix.family, right) ?? (parent.prefix.family === "IPV4" ? 32 : 128));
    if (leftSize === rightSize) return left.name.localeCompare(right.name, "fr");
    return leftSize < rightSize ? 1 : -1;
  });
  const subnets: VlsmSubnet[] = [];
  let cursor = parent.prefix.start;
  for (const request of ordered) {
    const length = requestPrefix(parent.prefix.family, request);
    if (length === null || length < parent.prefix.prefix) {
      return { feasible: false, family: parent.prefix.family, subnets, message: `Allocation impossible pour ${request.name}` };
    }
    const size = blockSize(parent.prefix.family, length);
    const aligned = align(cursor, size);
    const end = aligned + size - 1n;
    if (aligned < parent.prefix.start || end > parent.prefix.end) {
      return { feasible: false, family: parent.prefix.family, subnets, message: `Allocation impossible pour ${request.name} : l'espace restant ne suffit pas` };
    }
    const placed = parsePrefix(`${formatAddress(parent.prefix.family, aligned)}/${length}`);
    if (!placed.ok) {
      return { feasible: false, family: parent.prefix.family, subnets, message: `Allocation impossible pour ${request.name}` };
    }
    subnets.push(toSubnet(request.name, placed.prefix));
    cursor = end + 1n;
  }
  return { feasible: true, family: parent.prefix.family, subnets, message: null };
}

function toSubnet(name: string, prefix: ParsedPrefix): VlsmSubnet {
  return {
    name,
    cidr: prefix.cidr,
    prefix: prefix.prefix,
    network: prefix.network,
    netmask: prefix.netmask,
    firstUsable: prefix.firstUsable,
    lastUsable: prefix.lastUsable,
    broadcast: prefix.broadcast,
    total: prefix.total.toString(),
    usable: prefix.usable.toString(),
  };
}

function requestPrefix(family: IpFamily, request: VlsmRequest) {
  if (request.prefix !== undefined) {
    const max = family === "IPV4" ? 32 : 128;
    return request.prefix >= 0 && request.prefix <= max ? request.prefix : null;
  }
  if (!request.hosts || request.hosts < 1) return null;
  return prefixForHosts(family, request.hosts);
}

export function prefixForHosts(family: IpFamily, hosts: number) {
  const max = family === "IPV4" ? 32 : 128;
  for (let prefix = max; prefix >= 0; prefix -= 1) {
    if (usableCount(family, prefix) >= BigInt(hosts)) return prefix;
  }
  return null;
}

function blockSize(family: IpFamily, prefix: number) {
  const bits = family === "IPV4" ? 32 : 128;
  return 1n << BigInt(bits - prefix);
}

function usableCount(family: IpFamily, prefix: number) {
  const size = blockSize(family, prefix);
  if (family === "IPV4") return prefix >= 31 ? size : size - 2n;
  return prefix === 128 ? 1n : size - 1n;
}

function align(value: bigint, size: bigint) {
  const remainder = value % size;
  return remainder === 0n ? value : value + (size - remainder);
}
