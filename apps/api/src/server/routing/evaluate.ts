import { containsAddress, isUsable, parseAddress, parsePrefix, type ParsedPrefix } from "../ipam/address";

export const ROUTING_NOTICE = "Table de routage prévue. Aucun équipement réel n'est configuré.";
export const OSPF_NOTICE = "Architecture OSPF préparée. Aucun voisin n'est négocié et aucune route OSPF n'est calculée.";

export type RouteProtocol = "CONNECTED" | "STATIC" | "DEFAULT" | "OSPF";

export type ConnectedLink = { cidr: string; address: string; interfaceId: string; name: string };

export type RoutingIssue = { code: string; message: string };

export function connectedPrefix(addressText: string, cidr: string): { ok: true; destination: string; prefix: number; cidr: string } | { ok: false; message: string } {
  const prefix = parsePrefix(cidr);
  const address = parseAddress(addressText);
  if (!prefix.ok) return { ok: false, message: `Le préfixe ${cidr} est invalide` };
  if (!address || !isUsable(prefix.prefix, address)) {
    return { ok: false, message: `L'adresse ${addressText} n'est pas utilisable dans ${cidr}` };
  }
  return { ok: true, destination: prefix.prefix.network, prefix: prefix.prefix.prefix, cidr: prefix.prefix.cidr };
}

export function prepareRoute(
  input: { protocol: "STATIC" | "DEFAULT" | "OSPF"; cidr: string; gateway: string; metric?: number },
  connected: ConnectedLink[],
  existingCidrs: string[],
): { ok: true; destination: string; prefix: number; cidr: string; gateway: string; metric: number; protocol: "STATIC" | "DEFAULT" } | { ok: false; status: 422 | 409; message: string } {
  if (input.protocol === "OSPF") {
    return { ok: false, status: 422, message: "Les routes OSPF ne sont pas calculées. Déclarez le processus : aucun voisin n'est négocié." };
  }
  const parsed = parsePrefix(input.cidr);
  if (!parsed.ok) {
    return { ok: false, status: 422, message: parsed.reason === "HOST_BITS" ? `La route ${input.cidr.trim()} a des bits hôte` : `La route ${input.cidr.trim()} est invalide` };
  }
  const isDefault = parsed.prefix.prefix === 0;
  if (input.protocol === "DEFAULT" && !isDefault) return { ok: false, status: 422, message: "Une route par défaut doit être 0.0.0.0/0 ou ::/0" };
  if (input.protocol === "STATIC" && isDefault) return { ok: false, status: 422, message: "La route 0.0.0.0/0 est une route par défaut, pas une route statique" };
  const metric = input.metric ?? 1;
  if (!Number.isInteger(metric) || metric < 1 || metric > 255) return { ok: false, status: 422, message: "La métrique doit être comprise entre 1 et 255" };
  const gateway = parseAddress(input.gateway);
  if (!gateway) return { ok: false, status: 422, message: "La passerelle est invalide" };
  const reach = reachGateway(gateway.text, connected);
  if (!reach.ok) return { ok: false, status: 422, message: reach.message };
  if (existingCidrs.includes(parsed.prefix.cidr)) {
    return { ok: false, status: 409, message: `Une route vers ${parsed.prefix.cidr} existe déjà sur l'équipement` };
  }
  return { ok: true, destination: parsed.prefix.network, prefix: parsed.prefix.prefix, cidr: parsed.prefix.cidr, gateway: gateway.text, metric, protocol: input.protocol };
}

export function storedRouteIssues(cidr: string, gateway: string | null, connected: ConnectedLink[], planCidrs: string[]): RoutingIssue[] {
  const issues: RoutingIssue[] = [];
  const unknown = networkIssue(cidr, planCidrs);
  if (unknown) issues.push(unknown);
  if (gateway) {
    const reach = reachGateway(gateway, connected);
    if (!reach.ok) issues.push({ code: "GATEWAY_UNREACHABLE", message: reach.message });
  }
  return issues;
}

export function networkIssue(cidr: string, planCidrs: string[]): RoutingIssue | null {
  const parsed = parsePrefix(cidr);
  if (!parsed.ok || parsed.prefix.prefix === 0) return null;
  const known = planCidrs.some((item) => {
    const plan = parsePrefix(item);
    return plan.ok && containsAddress(plan.prefix, { family: parsed.prefix.family, value: parsed.prefix.start, text: parsed.prefix.network });
  });
  if (known) return null;
  return { code: "NETWORK_UNKNOWN", message: `Le réseau ${parsed.prefix.cidr} n'existe pas dans le plan d'adressage` };
}

export function interVlanPaths<T extends { vlan: { id: string; vid: number; name: string }; address: string; name: string; kind: string; device: { id: string; hostname: string } }>(interfaces: T[]) {
  const paths: Array<{ from: T; to: T; router: T["device"] }> = [];
  const byDevice = new Map<string, T[]>();
  for (const item of interfaces) {
    const list = byDevice.get(item.device.id) ?? [];
    list.push(item);
    byDevice.set(item.device.id, list);
  }
  for (const list of byDevice.values()) {
    const routed = list.filter((item) => item.vlan);
    for (let left = 0; left < routed.length; left += 1) {
      for (let right = left + 1; right < routed.length; right += 1) {
        const first = routed[left];
        const second = routed[right];
        if (!first || !second || first.vlan.id === second.vlan.id) continue;
        const [from, to] = first.vlan.vid < second.vlan.vid ? [first, second] : [second, first];
        paths.push({ from, to, router: from.device });
      }
    }
  }
  return paths.sort((left, right) => left.from.vlan.vid - right.from.vlan.vid || left.to.vlan.vid - right.to.vlan.vid);
}

function reachGateway(gateway: string, connected: ConnectedLink[]): { ok: true } | { ok: false; message: string } {
  const address = parseAddress(gateway);
  if (!address) return { ok: false, message: "La passerelle est invalide" };
  if (connected.some((link) => link.address === address.text)) {
    return { ok: false, message: `La passerelle ${address.text} est une adresse de l'équipement` };
  }
  const match = connected.some((link) => {
    const prefix = parsePrefix(link.cidr);
    return prefix.ok && isUsable(prefix.prefix, address);
  });
  if (!match) return { ok: false, message: `La passerelle ${address.text} n'est joignable par aucune route connectée` };
  return { ok: true };
}

export function containsPlan(prefix: ParsedPrefix, plan: ParsedPrefix) {
  return containsAddress(plan, { family: prefix.family, value: prefix.start, text: prefix.network });
}
