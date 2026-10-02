import { containsAddress, formatAddress, parseAddress, parsePrefix, type ParsedPrefix } from "../ipam/address";

export const DNS_TYPES = ["A", "AAAA", "CNAME", "MX", "NS", "PTR", "TXT", "SRV"] as const;
export type DnsType = (typeof DNS_TYPES)[number];
export type ZoneKind = "FORWARD" | "REVERSE";

const LABEL = /^(?:\*|[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?)$/;
const HOST = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;

export type DnsIssue = { code: string; message: string };

export type StoredRecord = {
  name: string;
  type: DnsType;
  rdata: string;
  ttl: number | null;
  priority: number | null;
  weight: number | null;
  port: number | null;
};

export type ZoneSnapshot = {
  id: string;
  name: string;
  kind: ZoneKind;
  enabled: boolean;
  cidr: string | null;
  records: StoredRecord[];
};

export const DNS_NOTICE = "Gestion et résolution locale. Aucun serveur DNS réel n'est interrogé.";

export function normalizeDnsName(input: string): string | null {
  const value = input.trim().toLowerCase().replace(/\.$/, "");
  if (!value || value.length > 253) return null;
  return value;
}

export function isHostName(input: string) {
  const name = normalizeDnsName(input);
  return Boolean(name && HOST.test(name));
}

export function isDnsName(input: string) {
  const name = normalizeDnsName(input);
  if (!name) return false;
  return name.split(".").every((label) => LABEL.test(label));
}

export function reverseZoneName(prefix: ParsedPrefix): string | null {
  if (prefix.family === "IPV4") {
    if (prefix.prefix % 8 !== 0 || prefix.prefix < 8 || prefix.prefix > 24) return null;
    const labels = prefix.network.split(".").slice(0, prefix.prefix / 8).reverse();
    return `${labels.join(".")}.in-addr.arpa`;
  }
  if (prefix.prefix % 4 !== 0 || prefix.prefix < 4 || prefix.prefix > 124) return null;
  const labels = nibbles(prefix.start).slice(0, prefix.prefix / 4).reverse();
  return `${labels.join(".")}.ip6.arpa`;
}

export function ptrRelativeName(prefix: ParsedPrefix, addressText: string): string | null {
  const address = parseAddress(addressText);
  if (!address || address.family !== prefix.family || !containsAddress(prefix, address)) return null;
  if (prefix.family === "IPV4") {
    if (prefix.prefix % 8 !== 0) return null;
    const host = address.text.split(".").slice(prefix.prefix / 8).reverse();
    return host.length ? host.join(".") : null;
  }
  const host = nibbles(address.value).slice(prefix.prefix / 4).reverse();
  return host.length ? host.join(".") : null;
}

export function addressFromPtr(prefix: ParsedPrefix, relativeName: string): string | null {
  if (prefix.family === "IPV4") {
    if (prefix.prefix % 8 !== 0) return null;
    const hostLabels = relativeName.split(".").filter(Boolean);
    const expected = 4 - prefix.prefix / 8;
    if (hostLabels.length !== expected) return null;
    if (hostLabels.some((label) => !/^\d+$/.test(label) || Number(label) > 255)) return null;
    const network = prefix.network.split(".").slice(0, prefix.prefix / 8);
    const parsed = parseAddress([...network, ...[...hostLabels].reverse()].join("."));
    if (!parsed || !containsAddress(prefix, parsed)) return null;
    return parsed.text;
  }
  const hostLabels = relativeName.split(".").filter(Boolean);
  const expected = (128 - prefix.prefix) / 4;
  if (hostLabels.length !== expected || hostLabels.some((label) => !/^[0-9a-f]$/.test(label))) return null;
  const full = [...nibbles(prefix.start).slice(0, prefix.prefix / 4), ...[...hostLabels].reverse()].join("");
  const parsed = parseAddress(formatAddress("IPV6", BigInt(`0x${full}`)));
  if (!parsed || !containsAddress(prefix, parsed)) return null;
  return parsed.text;
}

export function recordFqdn(zoneName: string, relativeName: string) {
  return relativeName === "@" ? zoneName : `${relativeName}.${zoneName}`;
}

export function prepareRecord(
  zone: { name: string; kind: ZoneKind; cidr: string | null },
  input: { name: string; type: DnsType; value: string; ttl?: number | null; priority?: number | null; weight?: number | null; port?: number | null },
  existing: StoredRecord[],
): { ok: true; record: StoredRecord } | { ok: false; status: 422 | 409; message: string } {
  const relative = relativeName(zone.name, input.name);
  if (!relative) return { ok: false, status: 422, message: "Le nom est hors de la zone ou invalide" };
  if (zone.kind === "REVERSE" && input.type !== "PTR" && input.type !== "NS" && input.type !== "TXT") {
    return { ok: false, status: 422, message: "Une zone inverse n'accepte que des PTR, NS et TXT" };
  }
  if (zone.kind === "FORWARD" && input.type === "PTR") {
    return { ok: false, status: 422, message: "Un PTR se place dans la zone inverse du sous-réseau" };
  }
  if (input.type === "CNAME" && relative === "@") {
    return { ok: false, status: 422, message: "Un CNAME ne peut pas être à l'apex de la zone" };
  }
  const built = buildRdata(zone, relative, input);
  if (!built.ok) return built;
  const record: StoredRecord = {
    name: relative,
    type: input.type,
    rdata: built.rdata,
    ttl: input.ttl ?? null,
    priority: built.priority,
    weight: built.weight,
    port: built.port,
  };
  const conflict = writeConflict(zone.name, existing, record);
  if (conflict) return { ok: false, status: 409, message: conflict };
  return { ok: true, record };
}

export function collectIssues(zones: ZoneSnapshot[], planCidrs: string[]): Array<DnsIssue & { zoneId: string; zone: string }> {
  const issues: Array<DnsIssue & { zoneId: string; zone: string }> = [];
  const forward = zones.filter((zone) => zone.kind === "FORWARD");
  const addresses = new Map<string, string[]>();
  for (const zone of forward) {
    for (const record of zone.records) {
      if (record.type !== "A" && record.type !== "AAAA") continue;
      const name = recordFqdn(zone.name, record.name);
      const current = addresses.get(name) ?? [];
      current.push(record.rdata);
      addresses.set(name, current);
    }
  }
  const reverseByAddress = new Map<string, { target: string; zone: string }>();
  for (const zone of zones) {
    if (!zone.enabled) continue;
    if (zone.kind === "FORWARD" && !zone.records.some((record) => record.type === "NS" && record.name === "@")) {
      issues.push({ zoneId: zone.id, zone: zone.name, code: "ZONE_WITHOUT_NS", message: `La zone ${zone.name} n'a pas de NS à l'apex` });
    }
    const prefix = zone.cidr ? parsePrefix(zone.cidr) : null;
    for (const record of zone.records) {
      const owner = recordFqdn(zone.name, record.name);
      if (record.type === "CNAME") {
        const others = zone.records.filter((item) => item.name === record.name && item.type !== "CNAME");
        if (others.length) {
          issues.push({ zoneId: zone.id, zone: zone.name, code: "CNAME_CONFLICT", message: `Le CNAME ${owner} coexiste avec d'autres enregistrements` });
        }
      }
      if ((record.type === "A" || record.type === "AAAA") && !planCidrs.some((cidr) => containsCidr(cidr, record.rdata))) {
        issues.push({ zoneId: zone.id, zone: zone.name, code: "ADDRESS_UNKNOWN", message: `${owner} pointe vers ${record.rdata}, absente du plan d'adressage` });
      }
      if (record.type === "PTR" && prefix?.ok) {
        const address = addressFromPtr(prefix.prefix, record.name);
        if (!address) {
          issues.push({ zoneId: zone.id, zone: zone.name, code: "PTR_OUTSIDE", message: `Le PTR ${record.name} n'appartient pas à ${zone.cidr}` });
        } else {
          reverseByAddress.set(address, { target: record.rdata, zone: zone.name });
          const forwardAddresses = addresses.get(record.rdata) ?? [];
          const targetIsLocal = forward.some((item) => record.rdata === item.name || record.rdata.endsWith(`.${item.name}`));
          if (targetIsLocal && !forwardAddresses.includes(address)) {
            issues.push({
              zoneId: zone.id,
              zone: zone.name,
              code: "PTR_MISMATCH",
              message: `Le PTR ${address} désigne ${record.rdata}, qui ne publie pas cette adresse`,
            });
          }
        }
      }
      if (record.type === "CNAME" || record.type === "MX" || record.type === "NS" || record.type === "SRV") {
        const target = record.type === "NS" || record.type === "MX" || record.type === "CNAME" || record.type === "SRV" ? record.rdata : "";
        const local = forward.find((item) => target === item.name || target.endsWith(`.${item.name}`));
        if (local && !(addresses.get(target)?.length)) {
          issues.push({ zoneId: zone.id, zone: zone.name, code: "TARGET_MISSING", message: `${owner} désigne ${target}, qui n'a ni A ni AAAA` });
        }
      }
    }
  }
  const missing = new Set<string>();
  for (const zone of forward) {
    for (const record of zone.records) {
      if (record.type !== "A" && record.type !== "AAAA" || missing.has(record.rdata)) continue;
      const reverse = zones.find((item) => item.kind === "REVERSE" && item.cidr && containsCidr(item.cidr, record.rdata));
      if (reverse && !reverseByAddress.has(record.rdata)) {
        missing.add(record.rdata);
        issues.push({
          zoneId: zone.id,
          zone: zone.name,
          code: "REVERSE_MISSING",
          message: `${record.rdata} n'a pas de PTR dans ${reverse.name}`,
        });
      }
    }
  }
  return issues;
}

export function resolveLocal(zones: ZoneSnapshot[], queryName: string, queryType?: DnsType) {
  const name = normalizeDnsName(queryName);
  if (!name) return { found: false, message: "Nom à résoudre invalide", trace: [] as StoredAnswer[], answers: [] as StoredAnswer[] };
  const address = parseAddress(name);
  if (address || queryType === "PTR") {
    return resolvePtr(zones, address?.text ?? name);
  }
  return resolveForward(zones, name, queryType ?? null, []);
}

export type StoredAnswer = { name: string; type: DnsType; rdata: string; ttl: number | null };

function resolveForward(zones: ZoneSnapshot[], name: string, queryType: DnsType | null, seen: string[]): { found: boolean; message: string; trace: StoredAnswer[]; answers: StoredAnswer[] } {
  if (seen.includes(name)) return { found: false, message: `Boucle CNAME sur ${name}`, trace: [], answers: [] };
  const zone = longestZone(zones.filter((item) => item.kind === "FORWARD" && item.enabled), name);
  if (!zone) return { found: false, message: `Aucune zone locale ne couvre ${name}`, trace: [], answers: [] };
  const relative = relativeName(zone.name, name);
  if (!relative) return { found: false, message: `${name} est hors de ${zone.name}`, trace: [], answers: [] };
  const records = zone.records.filter((record) => record.name === relative);
  if (!records.length) return { found: false, message: `Aucun enregistrement local pour ${name}`, trace: [], answers: [] };
  const cname = records.find((record) => record.type === "CNAME");
  if (cname && queryType !== "CNAME") {
    const step = toAnswer(zone.name, cname);
    const next = resolveForward(zones, cname.rdata, queryType, [...seen, name]);
    return { found: next.found, message: next.message, trace: [step, ...next.trace], answers: next.answers };
  }
  const selected = records.filter((record) => !queryType || record.type === queryType);
  if (!selected.length) return { found: false, message: `Aucun enregistrement ${queryType} pour ${name}`, trace: [], answers: [] };
  const answers = selected.map((record) => toAnswer(zone.name, record));
  return { found: true, message: `Résolu localement dans ${zone.name}`, trace: answers, answers };
}

function resolvePtr(zones: ZoneSnapshot[], addressText: string) {
  const address = parseAddress(addressText);
  if (!address) return { found: false, message: "Adresse PTR invalide", trace: [] as StoredAnswer[], answers: [] as StoredAnswer[] };
  const zone = zones.find((item) => item.kind === "REVERSE" && item.enabled && item.cidr && containsCidr(item.cidr, address.text));
  if (!zone?.cidr) return { found: false, message: `Aucune zone inverse locale ne couvre ${address.text}`, trace: [], answers: [] };
  const prefix = parsePrefix(zone.cidr);
  if (!prefix.ok) return { found: false, message: `La zone inverse ${zone.name} est invalide`, trace: [], answers: [] };
  const relative = ptrRelativeName(prefix.prefix, address.text);
  const record = zone.records.find((item) => item.type === "PTR" && item.name === relative);
  if (!record) return { found: false, message: `Aucun PTR local pour ${address.text}`, trace: [], answers: [] };
  const answer = toAnswer(zone.name, record);
  return { found: true, message: `PTR résolu localement dans ${zone.name}`, trace: [answer], answers: [answer] };
}

function toAnswer(zoneName: string, record: StoredRecord): StoredAnswer {
  return { name: recordFqdn(zoneName, record.name), type: record.type, rdata: record.rdata, ttl: record.ttl };
}

function longestZone(zones: ZoneSnapshot[], name: string) {
  return zones
    .filter((zone) => name === zone.name || name.endsWith(`.${zone.name}`))
    .sort((left, right) => right.name.length - left.name.length)[0];
}

function containsCidr(cidr: string, addressText: string) {
  const prefix = parsePrefix(cidr);
  const address = parseAddress(addressText);
  return Boolean(prefix.ok && address && containsAddress(prefix.prefix, address));
}

function writeConflict(zoneName: string, existing: StoredRecord[], record: StoredRecord) {
  const owner = recordFqdn(zoneName, record.name);
  if (existing.some((item) => item.name === record.name && item.type === record.type && item.rdata === record.rdata && item.priority === record.priority && item.weight === record.weight && item.port === record.port)) {
    return `L'enregistrement ${record.type} ${owner} existe déjà`;
  }
  const sameName = existing.filter((item) => item.name === record.name);
  if (record.type === "CNAME" && sameName.length) return `Le CNAME ${owner} est en conflit avec un enregistrement existant`;
  if (sameName.some((item) => item.type === "CNAME")) return `${owner} est déjà un CNAME`;
  return null;
}

function buildRdata(
  zone: { name: string; kind: ZoneKind; cidr: string | null },
  relative: string,
  input: { type: DnsType; value: string; priority?: number | null; weight?: number | null; port?: number | null },
): { ok: true; rdata: string; priority: number | null; weight: number | null; port: number | null } | { ok: false; status: 422; message: string } {
  const value = input.value.trim();
  if (input.type === "A" || input.type === "AAAA") {
    const address = parseAddress(value);
    if (!address || (input.type === "A" && address.family !== "IPV4") || (input.type === "AAAA" && address.family !== "IPV6")) {
      return { ok: false, status: 422, message: input.type === "A" ? "Un enregistrement A exige une IPv4" : "Un enregistrement AAAA exige une IPv6" };
    }
    return { ok: true, rdata: address.text, priority: null, weight: null, port: null };
  }
  if (input.type === "TXT") {
    const text = value.replace(/^"|"$/g, "");
    if (!text || text.length > 512) return { ok: false, status: 422, message: "Le TXT doit contenir entre 1 et 512 caractères" };
    return { ok: true, rdata: text, priority: null, weight: null, port: null };
  }
  if (input.type === "MX") {
    if (input.priority === undefined || input.priority === null || input.priority < 0 || input.priority > 65535) {
      return { ok: false, status: 422, message: "La priorité MX doit être comprise entre 0 et 65535" };
    }
    const target = absoluteHost(zone.name, value);
    if (!target) return { ok: false, status: 422, message: "La cible MX est invalide" };
    return { ok: true, rdata: target, priority: input.priority, weight: null, port: null };
  }
  if (input.type === "SRV") {
    if (input.priority === undefined || input.priority === null || input.weight === undefined || input.weight === null || input.port === undefined || input.port === null) {
      return { ok: false, status: 422, message: "Un SRV exige une priorité, un poids et un port" };
    }
    if (input.priority < 0 || input.priority > 65535 || input.weight < 0 || input.weight > 65535 || input.port < 1 || input.port > 65535) {
      return { ok: false, status: 422, message: "Les paramètres SRV sont hors limites" };
    }
    const target = absoluteHost(zone.name, value);
    if (!target) return { ok: false, status: 422, message: "La cible SRV est invalide" };
    return { ok: true, rdata: target, priority: input.priority, weight: input.weight, port: input.port };
  }
  if (input.type === "PTR") {
    const prefix = zone.cidr ? parsePrefix(zone.cidr) : null;
    if (!prefix?.ok) return { ok: false, status: 422, message: "La zone inverse n'est pas liée à un sous-réseau" };
    const address = addressFromPtr(prefix.prefix, relative);
    if (!address) return { ok: false, status: 422, message: `Le nom PTR ${relative} est hors du sous-réseau ${zone.cidr}` };
    const target = absoluteHost(zone.name, value);
    if (!target || target.endsWith(".arpa")) return { ok: false, status: 422, message: "La cible PTR doit être un nom d'hôte" };
    return { ok: true, rdata: target, priority: null, weight: null, port: null };
  }
  const target = absoluteHost(zone.name, value);
  if (!target) return { ok: false, status: 422, message: "La cible est invalide" };
  return { ok: true, rdata: target, priority: null, weight: null, port: null };
}

function absoluteHost(zoneName: string, input: string) {
  const name = normalizeDnsName(input);
  if (!name) return null;
  const fqdn = name.includes(".") ? name : `${name}.${zoneName}`;
  return isHostName(fqdn) ? fqdn : null;
}

function relativeName(zoneName: string, input: string) {
  const name = normalizeDnsName(input);
  if (!name) return null;
  if (name === "@" || name === zoneName) return "@";
  const relative = name.endsWith(`.${zoneName}`) ? name.slice(0, -(zoneName.length + 1)) : name;
  if (name.includes(".") && !name.endsWith(`.${zoneName}`)) return null;
  if (!relative || !isDnsName(relative)) return null;
  return relative;
}

function nibbles(value: bigint) {
  return value.toString(16).padStart(32, "0").split("");
}

export function prefixOf(cidr: string) {
  const parsed = parsePrefix(cidr);
  return parsed.ok ? parsed.prefix : null;
}
