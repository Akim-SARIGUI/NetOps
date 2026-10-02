import { parsePrefix, rangeContains } from "../ipam/address";

export const FIREWALL_NOTICE = "Politique prévue. Aucun pare-feu physique n'est configuré.";

export type PolicyAction = "ALLOW" | "DENY";
export type PolicyProtocol = "ANY" | "TCP" | "UDP" | "ICMP";
export type PolicyIssue = { code: "CONTRADICTION" | "IMPOSSIBLE" | "DUPLICATE" | "PRIORITY"; message: string };

export type NormalizedRule = {
  priority: number;
  source: string;
  destination: string;
  protocol: PolicyProtocol;
  sourcePort: string | null;
  destinationPort: string | null;
  action: PolicyAction;
  logging: boolean;
  enabled: boolean;
  signature: string;
};

type ExistingRule = { priority: number; signature: string; action: PolicyAction };

const PROTOCOLS = new Set<PolicyProtocol>(["ANY", "TCP", "UDP", "ICMP"]);

export function prepareRule(
  input: {
    priority: number;
    source: string;
    destination: string;
    protocol?: PolicyProtocol;
    sourcePort?: string | null;
    destinationPort?: string | null;
    action: PolicyAction;
    logging?: boolean;
    enabled?: boolean;
  },
  options: { mode: "flow" | "acl"; zones: string[]; existing: ExistingRule[] },
): { ok: true; rule: NormalizedRule } | { ok: false; status: 422 | 409; message: string } {
  if (!Number.isInteger(input.priority) || input.priority < 1 || input.priority > 65535) {
    return { ok: false, status: 422, message: "La priorité doit être un entier entre 1 et 65535" };
  }
  const protocol = input.protocol ?? "ANY";
  if (!PROTOCOLS.has(protocol)) return { ok: false, status: 422, message: "Le protocole est invalide" };
  const source = normalizeEndpoint(input.source, options);
  if (!source.ok) return { ok: false, status: 422, message: source.message.replace("extrémité", "source") };
  const destination = normalizeEndpoint(input.destination, options);
  if (!destination.ok) return { ok: false, status: 422, message: destination.message.replace("extrémité", "destination") };
  const sourcePort = normalizePort(input.sourcePort, "source");
  if (!sourcePort.ok) return sourcePort;
  const destinationPort = normalizePort(input.destinationPort, "destination");
  if (!destinationPort.ok) return destinationPort;
  if ((protocol === "ICMP" || protocol === "ANY") && (sourcePort.port || destinationPort.port)) {
    return { ok: false, status: 422, message: protocol === "ICMP" ? "Une règle ICMP ne peut pas fixer de port" : "Une règle de protocole ANY ne peut pas fixer de port" };
  }
  const signature = ruleSignature({ source: source.value, destination: destination.value, protocol, sourcePort: sourcePort.port, destinationPort: destinationPort.port });
  const samePriority = options.existing.find((rule) => rule.priority === input.priority);
  if (samePriority) return { ok: false, status: 409, message: `La priorité ${input.priority} est déjà utilisée` };
  const sameRule = options.existing.find((rule) => rule.signature === signature && rule.action === input.action);
  if (sameRule) return { ok: false, status: 409, message: `Une règle identique existe déjà à la priorité ${sameRule.priority}` };
  return {
    ok: true,
    rule: {
      priority: input.priority,
      source: source.value,
      destination: destination.value,
      protocol,
      sourcePort: sourcePort.port,
      destinationPort: destinationPort.port,
      action: input.action,
      logging: input.logging ?? false,
      enabled: input.enabled ?? true,
      signature,
    },
  };
}

export function collectIssues(rules: Array<NormalizedRule & { id: string }>): Array<PolicyIssue & { ruleId: string }> {
  const issues: Array<PolicyIssue & { ruleId: string }> = [];
  const enabled = rules.filter((rule) => rule.enabled);
  const bySignature = new Map<string, Array<NormalizedRule & { id: string }>>();
  for (const rule of enabled) {
    const group = bySignature.get(rule.signature) ?? [];
    group.push(rule);
    bySignature.set(rule.signature, group);
  }
  for (const group of bySignature.values()) {
    if (group.length < 2) continue;
    const actions = new Set(group.map((rule) => rule.action));
    for (const rule of group) {
      const other = group.find((item) => item.id !== rule.id);
      if (!other) continue;
      if (actions.size > 1) {
        issues.push({ ruleId: rule.id, code: "CONTRADICTION", message: `Cette règle contredit la priorité ${other.priority} (${other.action}) sur le même flux` });
      } else {
        issues.push({ ruleId: rule.id, code: "DUPLICATE", message: `Cette règle double la priorité ${other.priority}` });
      }
    }
  }
  const byPriority = new Map<number, string[]>();
  for (const rule of rules) {
    const ids = byPriority.get(rule.priority) ?? [];
    ids.push(rule.id);
    byPriority.set(rule.priority, ids);
  }
  for (const [priority, ids] of byPriority) {
    if (ids.length < 2) continue;
    for (const ruleId of ids) issues.push({ ruleId, code: "PRIORITY", message: `La priorité ${priority} est utilisée plusieurs fois` });
  }
  const ordered = [...enabled].sort((left, right) => left.priority - right.priority);
  for (let index = 0; index < ordered.length; index += 1) {
    const later = ordered[index];
    if (!later || issues.some((issue) => issue.ruleId === later.id && (issue.code === "CONTRADICTION" || issue.code === "DUPLICATE"))) continue;
    for (let earlierIndex = 0; earlierIndex < index; earlierIndex += 1) {
      const earlier = ordered[earlierIndex];
      if (!earlier || !covers(earlier, later)) continue;
      issues.push({ ruleId: later.id, code: "IMPOSSIBLE", message: `Cette règle ne peut pas s'appliquer : la priorité ${earlier.priority} couvre déjà ce flux` });
      break;
    }
  }
  return issues;
}

export function flowMatrix(
  vlans: Array<{ id: string; vid: number; name: string; zone: string | null }>,
  rules: NormalizedRule[],
) {
  const cells = vlans.flatMap((source) => vlans.map((destination) => {
    if (source.id === destination.id) {
      return { source, destination, action: null as PolicyAction | null, implicit: false, priority: null as number | null };
    }
    if (!source.zone || !destination.zone) {
      return { source, destination, action: null, implicit: false, priority: null };
    }
    const match = [...rules]
      .filter((rule) => rule.enabled && rule.protocol === "ANY" && !rule.sourcePort && !rule.destinationPort)
      .filter((rule) => matchesZone(rule.source, source.zone) && matchesZone(rule.destination, destination.zone))
      .sort((left, right) => left.priority - right.priority)[0];
    if (!match) return { source, destination, action: "DENY" as PolicyAction, implicit: true, priority: null };
    return { source, destination, action: match.action, implicit: false, priority: match.priority };
  }));
  return cells;
}

function matchesZone(endpoint: string, zone: string | null) {
  return Boolean(zone) && (endpoint === "ANY" || endpoint === zone);
}

function covers(earlier: NormalizedRule, later: NormalizedRule) {
  if (earlier.signature === later.signature) return false;
  return coversEndpoint(earlier.source, later.source)
    && coversEndpoint(earlier.destination, later.destination)
    && (earlier.protocol === "ANY" || earlier.protocol === later.protocol)
    && coversPort(earlier.sourcePort, later.sourcePort)
    && coversPort(earlier.destinationPort, later.destinationPort);
}

function coversEndpoint(broader: string, narrower: string) {
  if (broader === "ANY") return true;
  if (narrower === "ANY" || broader === narrower) return broader === narrower;
  const parent = parsePrefix(broader);
  const child = parsePrefix(narrower);
  if (!parent.ok || !child.ok) return false;
  return rangeContains(parent.prefix, child.prefix);
}

function coversPort(broader: string | null, narrower: string | null) {
  const left = portSpan(broader);
  const right = portSpan(narrower);
  return left.start <= right.start && left.end >= right.end;
}

function portSpan(port: string | null) {
  if (!port) return { start: 1, end: 65535 };
  const [rawStart, rawEnd] = port.split("-");
  return { start: Number(rawStart), end: Number(rawEnd ?? rawStart) };
}

function ruleSignature(rule: { source: string; destination: string; protocol: string; sourcePort: string | null; destinationPort: string | null }) {
  return `${rule.source}|${rule.destination}|${rule.protocol}|${rule.sourcePort ?? "*"}|${rule.destinationPort ?? "*"}`;
}

function normalizeEndpoint(value: string, options: { mode: "flow" | "acl"; zones: string[] }): { ok: true; value: string } | { ok: false; message: string } {
  const text = value.trim();
  if (!text) return { ok: false, message: "L'extrémité est vide" };
  if (text.toUpperCase() === "ANY") return { ok: true, value: "ANY" };
  const zone = text.toUpperCase();
  if (options.zones.includes(zone) && !text.includes("/")) return { ok: true, value: zone };
  if (options.mode === "flow") return { ok: false, message: `L'extrémité ${text} n'est pas une zone de sécurité` };
  const prefix = parsePrefix(text);
  if (!prefix.ok) {
    return { ok: false, message: prefix.reason === "HOST_BITS" ? `Le préfixe ${text.trim()} a des bits hôte` : `L'extrémité ${text} n'est ni une zone ni un préfixe valide` };
  }
  return { ok: true, value: prefix.prefix.cidr };
}

function normalizePort(value: string | null | undefined, side: "source" | "destination"): { ok: true; port: string | null } | { ok: false; status: 422; message: string } {
  if (value === undefined || value === null || value.trim() === "") return { ok: true, port: null };
  const match = /^(\d{1,5})(?:-(\d{1,5}))?$/.exec(value.trim());
  if (!match) return { ok: false, status: 422, message: `Le port ${side} est invalide` };
  const start = Number(match[1]);
  const end = Number(match[2] ?? match[1]);
  if (start < 1 || end > 65535) return { ok: false, status: 422, message: `Le port ${side} est invalide` };
  if (start > end) return { ok: false, status: 422, message: `La plage de ports ${side} est inversée` };
  return { ok: true, port: start === end ? String(start) : `${start}-${end}` };
}
