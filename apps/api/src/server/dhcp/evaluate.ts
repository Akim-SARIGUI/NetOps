import {
  formatAddress,
  isUsable,
  parseAddress,
  parsePrefix,
  rangesOverlap,
  type ParsedPrefix,
} from "../ipam/address";

export type DhcpIssue = { code: string; message: string };

export type Interval = { start: bigint; end: bigint };

type RangeText = { startAddress: string; endAddress: string };
type ReservationText = { address: string; macAddress: string };
type LeaseText = { address: string; macAddress: string; state: string; expiresAt: Date };

export function isLeaseActive(lease: { state: string; expiresAt: Date }, now: Date) {
  return lease.state === "ACTIVE" && lease.expiresAt.getTime() > now.getTime();
}

export function readRange(startText: string, endText: string, family: ParsedPrefix["family"]): { start: string; end: string; interval: Interval } | null {
  const start = parseAddress(startText);
  const end = parseAddress(endText);
  if (!start || !end || start.family !== family || end.family !== family || start.value > end.value) return null;
  return { start: start.text, end: end.text, interval: { start: start.value, end: end.value } };
}

function insideUsable(prefix: ParsedPrefix, interval: Interval) {
  return prefix.firstValue !== null && prefix.lastValue !== null && interval.start >= prefix.firstValue && interval.end <= prefix.lastValue;
}

function merge(ranges: Interval[]): Interval[] {
  const sorted = [...ranges].sort((left, right) => (left.start < right.start ? -1 : left.start > right.start ? 1 : 0));
  const merged: Interval[] = [];
  for (const range of sorted) {
    const last = merged.at(-1);
    if (!last || range.start > last.end + 1n) merged.push({ ...range });
    else if (range.end > last.end) last.end = range.end;
  }
  return merged;
}

function measure(ranges: Interval[]) {
  return merge(ranges).reduce((sum, range) => sum + (range.end - range.start + 1n), 0n);
}

function subtract(base: Interval[], cuts: Interval[]): Interval[] {
  let current = merge(base);
  for (const cut of merge(cuts)) {
    const next: Interval[] = [];
    for (const range of current) {
      if (cut.end < range.start || cut.start > range.end) {
        next.push(range);
        continue;
      }
      if (range.start < cut.start) next.push({ start: range.start, end: cut.start - 1n });
      if (range.end > cut.end) next.push({ start: cut.end + 1n, end: range.end });
    }
    current = next;
  }
  return current;
}

function containsValue(ranges: Interval[], value: bigint) {
  return ranges.some((range) => value >= range.start && value <= range.end);
}

function ratio(used: bigint, capacity: bigint) {
  if (capacity <= 0n) return 0;
  return Number((used * 10000n) / capacity) / 100;
}

export function poolIssue(
  prefix: ParsedPrefix,
  existing: RangeText[],
  startText: string,
  endText: string,
): { ok: true; start: string; end: string } | { ok: false; status: 422 | 409; message: string } {
  const range = readRange(startText, endText, prefix.family);
  if (!range) return { ok: false, status: 422, message: "Le pool contient une adresse invalide ou une fin qui précède le début" };
  if (!insideUsable(prefix, range.interval)) {
    return { ok: false, status: 422, message: `Le pool ${range.start} → ${range.end} est hors du sous-réseau ${prefix.cidr}` };
  }
  for (const pool of existing) {
    const other = readRange(pool.startAddress, pool.endAddress, prefix.family);
    if (other && rangesOverlap(range.interval, other.interval)) {
      return { ok: false, status: 409, message: `Le pool ${range.start} → ${range.end} chevauche ${other.start} → ${other.end}` };
    }
  }
  return { ok: true, start: range.start, end: range.end };
}

export function exclusionIssue(
  prefix: ParsedPrefix,
  startText: string,
  endText: string,
): { ok: true; start: string; end: string } | { ok: false; message: string } {
  const range = readRange(startText, endText, prefix.family);
  if (!range) return { ok: false, message: "L'exclusion contient une adresse invalide ou une fin qui précède le début" };
  if (!insideUsable(prefix, range.interval)) {
    return { ok: false, message: `L'exclusion ${range.start} → ${range.end} est hors du sous-réseau ${prefix.cidr}` };
  }
  return { ok: true, start: range.start, end: range.end };
}

export function gatewayIssue(prefix: ParsedPrefix, gatewayText: string): string | null {
  const gateway = parseAddress(gatewayText);
  if (!gateway || gateway.family !== prefix.family || !isUsable(prefix, gateway)) {
    return `La passerelle ${gatewayText.trim()} n'appartient pas au sous-réseau ${prefix.cidr}`;
  }
  return null;
}

export function reservationIssue(
  prefix: ParsedPrefix,
  gatewayText: string,
  exclusions: RangeText[],
  reservations: ReservationText[],
  leases: LeaseText[],
  candidate: { address: string; macAddress: string },
  now: Date,
): { ok: true; address: string; macAddress: string } | { ok: false; status: 422 | 409; message: string } {
  const address = parseAddress(candidate.address);
  if (!address || address.family !== prefix.family || !isUsable(prefix, address)) {
    return { ok: false, status: 422, message: `La réservation ${candidate.address.trim()} est hors du sous-réseau ${prefix.cidr}` };
  }
  const gateway = parseAddress(gatewayText);
  if (gateway && address.value === gateway.value) {
    return { ok: false, status: 409, message: `La réservation ${address.text} est en conflit avec la passerelle` };
  }
  const excluded = exclusions.flatMap((exclusion) => {
    const range = readRange(exclusion.startAddress, exclusion.endAddress, prefix.family);
    return range ? [range.interval] : [];
  });
  if (containsValue(excluded, address.value)) {
    return { ok: false, status: 409, message: `La réservation ${address.text} est en conflit avec une exclusion` };
  }
  if (reservations.some((reservation) => parseAddress(reservation.address)?.value === address.value)) {
    return { ok: false, status: 409, message: `La réservation ${address.text} est en conflit avec une autre réservation` };
  }
  if (reservations.some((reservation) => reservation.macAddress === candidate.macAddress)) {
    return { ok: false, status: 409, message: `La réservation ${candidate.macAddress} est en conflit avec une autre réservation` };
  }
  const lease = leases.find((item) => isLeaseActive(item, now) && parseAddress(item.address)?.value === address.value);
  if (lease && lease.macAddress !== candidate.macAddress) {
    return { ok: false, status: 409, message: `La réservation ${address.text} est en conflit avec un bail actif` };
  }
  return { ok: true, address: address.text, macAddress: candidate.macAddress };
}

export function selectLeaseAddress(input: {
  prefix: ParsedPrefix;
  gateway: string;
  pools: RangeText[];
  exclusions: RangeText[];
  reservations: ReservationText[];
  leases: LeaseText[];
  macAddress: string;
  now: Date;
}): { ok: true; address: string } | { ok: false; message: string } {
  const pools = input.pools.flatMap((pool) => {
    const range = readRange(pool.startAddress, pool.endAddress, input.prefix.family);
    return range && insideUsable(input.prefix, range.interval) ? [range.interval] : [];
  });
  const exclusions = input.exclusions.flatMap((exclusion) => {
    const range = readRange(exclusion.startAddress, exclusion.endAddress, input.prefix.family);
    return range ? [range.interval] : [];
  });
  const reserved = input.reservations.find((reservation) => reservation.macAddress === input.macAddress);
  if (reserved) {
    const address = parseAddress(reserved.address);
    const gateway = parseAddress(input.gateway);
    if (!address || !isUsable(input.prefix, address) || (gateway && address.value === gateway.value) || containsValue(exclusions, address.value)) {
      return { ok: false, message: `La réservation ${reserved.address} est en conflit et ne peut pas être attribuée` };
    }
    const holder = input.leases.find((lease) => isLeaseActive(lease, input.now) && parseAddress(lease.address)?.text === address.text);
    if (holder && holder.macAddress !== input.macAddress) {
      return { ok: false, message: `La réservation ${address.text} est en conflit avec un bail actif` };
    }
    return { ok: true, address: address.text };
  }
  const taken = [...input.reservations, ...input.leases.filter((lease) => isLeaseActive(lease, input.now))].flatMap((item) => {
    const parsed = parseAddress(item.address);
    return parsed ? [{ start: parsed.value, end: parsed.value }] : [];
  });
  const free = subtract(subtract(pools, exclusions), taken);
  const next = free[0];
  if (!next) return { ok: false, message: `Le pool du sous-réseau ${input.prefix.cidr} est épuisé` };
  return { ok: true, address: formatAddress(input.prefix.family, next.start) };
}

export function manualLeaseIssue(input: {
  prefix: ParsedPrefix;
  gateway: string;
  pools: RangeText[];
  exclusions: RangeText[];
  reservations: ReservationText[];
  leases: LeaseText[];
  address: string;
  macAddress: string;
  now: Date;
}): { ok: true; address: string } | { ok: false; status: 422 | 409; message: string } {
  const address = parseAddress(input.address);
  if (!address || address.family !== input.prefix.family || !isUsable(input.prefix, address)) {
    return { ok: false, status: 422, message: `L'adresse ${input.address.trim()} est hors du sous-réseau ${input.prefix.cidr}` };
  }
  const gateway = parseAddress(input.gateway);
  if (gateway && address.value === gateway.value) {
    return { ok: false, status: 409, message: `L'adresse ${address.text} est la passerelle et ne peut pas être attribuée` };
  }
  const exclusions = input.exclusions.flatMap((exclusion) => {
    const range = readRange(exclusion.startAddress, exclusion.endAddress, input.prefix.family);
    return range ? [range.interval] : [];
  });
  if (containsValue(exclusions, address.value)) {
    return { ok: false, status: 409, message: `L'adresse ${address.text} est en conflit avec une exclusion` };
  }
  const byMac = input.reservations.find((reservation) => reservation.macAddress === input.macAddress);
  if (byMac && parseAddress(byMac.address)?.text !== address.text) {
    return { ok: false, status: 409, message: `La MAC ${input.macAddress} est réservée pour ${byMac.address}` };
  }
  const byAddress = input.reservations.find((reservation) => parseAddress(reservation.address)?.text === address.text);
  if (byAddress && byAddress.macAddress !== input.macAddress) {
    return { ok: false, status: 409, message: `L'adresse ${address.text} est réservée pour une autre MAC` };
  }
  const pools = input.pools.flatMap((pool) => {
    const range = readRange(pool.startAddress, pool.endAddress, input.prefix.family);
    return range ? [range.interval] : [];
  });
  if (!byMac && !containsValue(pools, address.value)) {
    return { ok: false, status: 422, message: `L'adresse ${address.text} est hors des pools` };
  }
  const holder = input.leases.find((lease) => isLeaseActive(lease, input.now) && parseAddress(lease.address)?.text === address.text);
  if (holder && holder.macAddress !== input.macAddress) {
    return { ok: false, status: 409, message: `L'adresse ${address.text} est en conflit avec un bail actif` };
  }
  return { ok: true, address: address.text };
}

export function describeScope(input: {
  cidr: string;
  gateway: string;
  ipamGateway: string | null;
  pools: RangeText[];
  exclusions: RangeText[];
  reservations: ReservationText[];
  leases: LeaseText[];
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const issues: DhcpIssue[] = [];
  const parsed = parsePrefix(input.cidr);
  if (!parsed.ok) {
    issues.push({ code: "INVALID_SUBNET", message: `Le préfixe ${input.cidr} est invalide` });
    return { issues, capacity: "0", used: "0", available: "0", utilization: 0, exhausted: false, activeLeases: 0 };
  }
  const prefix = parsed.prefix;
  if (input.pools.length === 0) issues.push({ code: "SCOPE_WITHOUT_POOL", message: `Le scope ${prefix.cidr} n'a aucun pool` });
  const gatewayError = gatewayIssue(prefix, input.gateway);
  if (gatewayError) issues.push({ code: "GATEWAY_INVALID", message: gatewayError });
  else if (input.ipamGateway) {
    const recorded = parseAddress(input.ipamGateway);
    const chosen = parseAddress(input.gateway);
    if (recorded && chosen && recorded.text !== chosen.text) {
      issues.push({ code: "GATEWAY_MISMATCH", message: `La passerelle DHCP ${chosen.text} diffère de la passerelle du sous-réseau ${recorded.text}` });
    }
  }
  const usablePools: Interval[] = [];
  for (const pool of input.pools) {
    const range = readRange(pool.startAddress, pool.endAddress, prefix.family);
    if (!range || !insideUsable(prefix, range.interval)) {
      issues.push({ code: "POOL_OUTSIDE", message: `Le pool ${pool.startAddress} → ${pool.endAddress} est hors du sous-réseau ${prefix.cidr}` });
      continue;
    }
    usablePools.push(range.interval);
  }
  for (let left = 0; left < usablePools.length; left += 1) {
    for (let right = left + 1; right < usablePools.length; right += 1) {
      const first = usablePools[left];
      const second = usablePools[right];
      if (!first || !second || !rangesOverlap(first, second)) continue;
      issues.push({
        code: "POOL_OVERLAP",
        message: `Le pool ${formatAddress(prefix.family, first.start)} → ${formatAddress(prefix.family, first.end)} chevauche ${formatAddress(prefix.family, second.start)} → ${formatAddress(prefix.family, second.end)}`,
      });
    }
  }
  for (let index = 0; index < input.reservations.length; index += 1) {
    const candidate = input.reservations[index];
    if (!candidate) continue;
    const others = input.reservations.filter((_, other) => other !== index);
    const result = reservationIssue(prefix, input.gateway, input.exclusions, others, input.leases, candidate, now);
    if (!result.ok) issues.push({ code: "RESERVATION_CONFLICT", message: result.message });
  }
  const exclusionIntervals = input.exclusions.flatMap((exclusion) => {
    const range = readRange(exclusion.startAddress, exclusion.endAddress, prefix.family);
    return range ? [range.interval] : [];
  });
  const free = subtract(usablePools, exclusionIntervals);
  const capacity = measure(free);
  const usedAddresses = new Set<string>();
  for (const reservation of input.reservations) {
    const address = parseAddress(reservation.address);
    if (address && containsValue(free, address.value)) usedAddresses.add(address.text);
  }
  let activeLeases = 0;
  for (const lease of input.leases) {
    if (!isLeaseActive(lease, now)) continue;
    activeLeases += 1;
    const address = parseAddress(lease.address);
    if (address && containsValue(free, address.value)) usedAddresses.add(address.text);
  }
  const used = BigInt(usedAddresses.size);
  const available = capacity > used ? capacity - used : 0n;
  const exhausted = input.pools.length > 0 && available === 0n;
  if (exhausted) issues.push({ code: "POOL_EXHAUSTED", message: `Le pool du sous-réseau ${prefix.cidr} est épuisé` });
  return {
    issues,
    capacity: capacity.toString(),
    used: used.toString(),
    available: available.toString(),
    utilization: input.pools.length > 0 && capacity === 0n ? 100 : ratio(used, capacity),
    exhausted,
    activeLeases,
  };
}
