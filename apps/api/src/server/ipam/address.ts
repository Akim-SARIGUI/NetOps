export type IpFamily = "IPV4" | "IPV6";

export type ParsedPrefix = {
  family: IpFamily;
  prefix: number;
  start: bigint;
  end: bigint;
  size: bigint;
  network: string;
  netmask: string;
  cidr: string;
  broadcast: string | null;
  firstUsable: string | null;
  lastUsable: string | null;
  firstValue: bigint | null;
  lastValue: bigint | null;
  total: bigint;
  usable: bigint;
};

export type ParsedAddress = {
  family: IpFamily;
  value: bigint;
  text: string;
};

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

const IPV4_MAX = (1n << 32n) - 1n;
const IPV6_MAX = (1n << 128n) - 1n;

export function parseAddress(input: string): ParsedAddress | null {
  const value = input.trim();
  const ipv4 = parseIpv4(value);
  if (ipv4 !== null) return { family: "IPV4", value: ipv4, text: formatIpv4(ipv4) };
  const ipv6 = parseIpv6(value);
  if (ipv6 !== null) return { family: "IPV6", value: ipv6, text: formatIpv6(ipv6) };
  return null;
}

export function canonicalizeAddress(input: string): string | null {
  return parseAddress(input)?.text ?? null;
}

export function parsePrefix(input: string): { ok: true; prefix: ParsedPrefix } | { ok: false; reason: "INVALID" | "HOST_BITS" } {
  const value = input.trim();
  const slash = value.lastIndexOf("/");
  if (slash <= 0) return { ok: false, reason: "INVALID" };
  const address = parseAddress(value.slice(0, slash));
  const prefixText = value.slice(slash + 1);
  if (!address || !/^\d+$/.test(prefixText)) return { ok: false, reason: "INVALID" };
  const prefix = Number(prefixText);
  const max = address.family === "IPV4" ? 32 : 128;
  if (prefix > max) return { ok: false, reason: "INVALID" };
  const parsed = describe(address.family, address.value, prefix);
  if (address.value !== parsed.start) return { ok: false, reason: "HOST_BITS" };
  return { ok: true, prefix: parsed };
}

export function rangesOverlap(left: { start: bigint; end: bigint }, right: { start: bigint; end: bigint }) {
  return left.start <= right.end && right.start <= left.end;
}

export function rangeContains(parent: { start: bigint; end: bigint }, child: { start: bigint; end: bigint }) {
  return parent.start <= child.start && child.end <= parent.end;
}

export function containsAddress(prefix: ParsedPrefix, address: ParsedAddress) {
  return prefix.family === address.family && address.value >= prefix.start && address.value <= prefix.end;
}

export function isUsable(prefix: ParsedPrefix, address: ParsedAddress) {
  if (!containsAddress(prefix, address) || prefix.firstValue === null || prefix.lastValue === null) return false;
  return address.value >= prefix.firstValue && address.value <= prefix.lastValue;
}

export function placement(prefix: ParsedPrefix, address: ParsedAddress): "OK" | "OUTSIDE" | "NETWORK" | "BROADCAST" {
  if (!containsAddress(prefix, address)) return "OUTSIDE";
  if (isUsable(prefix, address)) return "OK";
  if (address.value === prefix.start) return "NETWORK";
  return "BROADCAST";
}

export function nextUsable(prefix: ParsedPrefix, used: bigint[]): bigint | null {
  if (prefix.firstValue === null || prefix.lastValue === null) return null;
  const sorted = [...used].filter((value) => value >= prefix.firstValue! && value <= prefix.lastValue!).sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  let cursor = prefix.firstValue;
  for (const value of sorted) {
    if (value > cursor) return cursor;
    if (value === cursor) {
      cursor += 1n;
      if (cursor > prefix.lastValue) return null;
    }
  }
  return cursor <= prefix.lastValue ? cursor : null;
}

export function summarize(prefix: ParsedPrefix, used: bigint): PrefixStats {
  const available = used >= prefix.usable ? 0n : prefix.usable - used;
  return {
    family: prefix.family,
    network: prefix.network,
    netmask: prefix.netmask,
    prefix: prefix.prefix,
    cidr: prefix.cidr,
    firstUsable: prefix.firstUsable,
    lastUsable: prefix.lastUsable,
    broadcast: prefix.broadcast,
    total: prefix.total.toString(),
    usable: prefix.usable.toString(),
    used: used.toString(),
    available: available.toString(),
    utilization: percent(used, prefix.usable),
  };
}

export function formatAddress(family: IpFamily, value: bigint) {
  return family === "IPV4" ? formatIpv4(value) : formatIpv6(value);
}

export type GridCell = { address: string; kind: "free" | "network" | "broadcast" | "gateway" | "allocated" | "reserved" };

export function utilizationGrid(prefix: ParsedPrefix, marks: Map<string, "gateway" | "allocated" | "reserved">): GridCell[] | null {
  if (prefix.total > 256n) return null;
  const cells: GridCell[] = [];
  for (let offset = 0n; offset < prefix.total; offset += 1n) {
    const value = prefix.start + offset;
    const address = formatAddress(prefix.family, value);
    let kind: GridCell["kind"] = "free";
    if (prefix.family === "IPV4" && prefix.prefix <= 30 && offset === 0n) kind = "network";
    else if (prefix.family === "IPV4" && prefix.prefix <= 30 && offset === prefix.total - 1n) kind = "broadcast";
    else if (prefix.firstValue !== null && (value < prefix.firstValue || value > prefix.lastValue!)) kind = "network";
    const mark = marks.get(address);
    if (mark) kind = mark;
    cells.push({ address, kind });
  }
  return cells;
}

function percent(used: bigint, usable: bigint) {
  if (usable <= 0n) return used > 0n ? 100 : 0;
  const scaled = (used * 10000n) / usable;
  return Number(scaled) / 100;
}

function describe(family: IpFamily, value: bigint, prefix: number): ParsedPrefix {
  const bits = family === "IPV4" ? 32 : 128;
  const width = (1n << BigInt(bits)) - 1n;
  const hostBits = bits - prefix;
  const size = 1n << BigInt(hostBits);
  const mask = hostBits === bits ? 0n : (width << BigInt(0)) & (width ^ (size - 1n));
  const start = value & mask;
  const end = start + size - 1n;
  const single = prefix === (family === "IPV4" ? 32 : 128);
  const pointToPoint = family === "IPV4" && prefix === 31;
  const classic = family === "IPV4" && prefix <= 30;
  const firstValue = single || pointToPoint ? start : start + 1n;
  const lastValue = classic ? end - 1n : end;
  const usable = single || pointToPoint ? size : classic ? size - 2n : size - 1n;
  return {
    family,
    prefix,
    start,
    end,
    size,
    network: formatAddress(family, start),
    netmask: formatAddress(family, mask),
    cidr: `${formatAddress(family, start)}/${prefix}`,
    broadcast: classic ? formatAddress(family, end) : null,
    firstUsable: formatAddress(family, firstValue),
    lastUsable: formatAddress(family, lastValue),
    firstValue,
    lastValue,
    total: size,
    usable,
  };
}

function parseIpv4(value: string): bigint | null {
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  let result = 0n;
  for (const part of parts) {
    if (!/^\d+$/.test(part) || (part.length > 1 && part.startsWith("0")) || Number(part) > 255) return null;
    result = (result << 8n) + BigInt(Number(part));
  }
  return result <= IPV4_MAX ? result : null;
}

function formatIpv4(value: bigint) {
  return [24, 16, 8, 0].map((shift) => Number((value >> BigInt(shift)) & 255n)).join(".");
}

function parseIpv6(value: string): bigint | null {
  const text = value.trim().toLowerCase();
  if (!text.includes(":") || text.includes("%")) return null;
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const parseSide = (part: string) => {
    if (part === "") return [] as number[];
    const groups = part.split(":");
    const numbers: number[] = [];
    for (const group of groups) {
      if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
      numbers.push(Number.parseInt(group, 16));
    }
    return numbers;
  };
  const left = parseSide(halves[0] ?? "");
  if (!left) return null;
  if (halves.length === 1) {
    if (left.length !== 8) return null;
    return groupsToBigint(left);
  }
  const right = parseSide(halves[1] ?? "");
  if (!right || left.length + right.length > 7) return null;
  const zeros = Array.from({ length: 8 - left.length - right.length }, () => 0);
  return groupsToBigint([...left, ...zeros, ...right]);
}

function groupsToBigint(groups: number[]) {
  return groups.reduce((total, group) => (total << 16n) + BigInt(group), 0n) & IPV6_MAX;
}

function formatIpv6(value: bigint) {
  const groups = Array.from({ length: 8 }, (_, index) => Number((value >> BigInt((7 - index) * 16)) & 0xffffn).toString(16));
  let bestStart = -1;
  let bestLength = 0;
  let index = 0;
  while (index < groups.length) {
    if (groups[index] !== "0") {
      index += 1;
      continue;
    }
    let end = index;
    while (end < groups.length && groups[end] === "0") end += 1;
    if (end - index > bestLength) {
      bestStart = index;
      bestLength = end - index;
    }
    index = end;
  }
  if (bestLength < 2) return groups.join(":");
  const left = groups.slice(0, bestStart).join(":");
  const right = groups.slice(bestStart + bestLength).join(":");
  if (!left && !right) return "::";
  if (!left) return `::${right}`;
  if (!right) return `${left}::`;
  return `${left}::${right}`;
}
