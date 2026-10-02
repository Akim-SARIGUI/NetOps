import { parseAddress, parsePrefix } from "../ipam/address";

export const DIAGNOSTIC_NOTICE =
  "Diagnostic guidé à partir de l'inventaire. Aucun équipement réel n'est interrogé. Une cause possible n'est pas une certitude.";
export const PROBE_NOTICE =
  "Les sondes ping, traceroute, DNS, TCP, ARP, route, HTTP et test de port sont préparées. Aucune n'envoie de paquet.";

export const TOOLS = ["PING", "TRACEROUTE", "DNS", "TCP", "ARP", "ROUTE", "HTTP", "PORT"] as const;
export const MODES = ["INVENTORY", "LIVE"] as const;
export const AUTHORIZED_PORTS = [22, 53, 80, 443] as const;

export const GUIDE_STEPS = [
  { id: "CLIENT", label: "Client sans IP" },
  { id: "INTERFACE", label: "Interface" },
  { id: "SWITCH_PORT", label: "Switch port" },
  { id: "VLAN", label: "VLAN" },
  { id: "TRUNK", label: "Trunk" },
  { id: "DHCP_RELAY", label: "DHCP Relay" },
  { id: "DHCP_SCOPE", label: "DHCP Scope" },
  { id: "DHCP_SERVER", label: "DHCP Server" },
] as const;

export type ToolId = (typeof TOOLS)[number];
export type DiagnosticMode = (typeof MODES)[number];
export type GuideStepId = (typeof GUIDE_STEPS)[number]["id"];

export type VlanRef = { vid: number; name: string };

export type DiagnosticInterface = {
  name: string;
  ipAddress: string | null;
  macAddress: string | null;
  status: string;
};

export type DiagnosticPort = {
  name: string;
  switchHostname: string;
  status: string;
  mode: "ACCESS" | "TRUNK";
  connectedHostname: string | null;
  accessVlan: VlanRef | null;
  nativeVlan: VlanRef | null;
  allowedVlans: VlanRef[];
};

export type DiagnosticSubnet = {
  cidr: string;
  gateway: string | null;
  vlan: VlanRef;
  relays: Array<{ helperAddress: string; serverName: string }>;
  scope: { enabled: boolean; serverName: string; serverStatus: string; serverAddress: string | null } | null;
};

export type DiagnosticLayer3 = {
  deviceHostname: string;
  name: string;
  address: string;
  cidr: string;
  vlanVid: number | null;
  status: string;
};

export type DiagnosticRoute = {
  deviceHostname: string;
  cidr: string;
  gateway: string | null;
  protocol: string;
  status: string;
};

export type DiagnosticDns = { zone: string; name: string; type: string; rdata: string };
export type DiagnosticServer = { name: string; status: string; address: string | null };

export type DiagnosticSnapshot = {
  hostname: string;
  role: string;
  status: string;
  managementIp: string | null;
  interfaces: DiagnosticInterface[];
  connectedPorts: DiagnosticPort[];
  sitePorts: DiagnosticPort[];
  subnets: DiagnosticSubnet[];
  layer3: DiagnosticLayer3[];
  routes: DiagnosticRoute[];
  dnsRecords: DiagnosticDns[];
  dhcpServers: DiagnosticServer[];
};

export type Statement = {
  fact: string;
  observation: string;
  possibleCause: string;
  recommendedCheck: string;
};

export type GuideStep = Statement & { step: GuideStepId; label: string; available: true };
export type ProbeOutcome = Statement & { tool: ToolId; available: boolean };

const LIVE_MESSAGE: Record<ToolId, string> = {
  PING: "Le connecteur ICMP n'est pas intégré. Aucun paquet n'a été envoyé.",
  TRACEROUTE: "Le traceroute n'est pas intégré. Aucun paquet n'a été envoyé.",
  DNS: "Le résolveur DNS n'est pas intégré. Aucune requête n'a été envoyée.",
  TCP: "Le test TCP n'est pas intégré. Aucune connexion n'a été ouverte.",
  ARP: "La lecture ARP distante n'est pas intégrée. Aucune table n'a été lue.",
  ROUTE: "La lecture distante de la table de routage n'est pas intégrée. Aucune table n'a été lue.",
  HTTP: "Le contrôle HTTP n'est pas intégré. Aucune requête n'a été envoyée.",
  PORT: "Le test de port n'est pas intégré. Aucune connexion n'a été ouverte.",
};

export function authorizePort(port: number) {
  if (!AUTHORIZED_PORTS.includes(port as (typeof AUTHORIZED_PORTS)[number])) {
    return "Ce port n'est pas autorisé pour un diagnostic.";
  }
  return null;
}

export function guide(snapshot: DiagnosticSnapshot): GuideStep[] {
  const address = primaryAddress(snapshot);
  const subnet = address ? longestSubnet(snapshot, address) : null;
  return [
    step("CLIENT", clientStep(snapshot)),
    step("INTERFACE", interfaceStep(snapshot)),
    step("SWITCH_PORT", switchPortStep(snapshot, subnet)),
    step("VLAN", vlanStep(snapshot, address, subnet)),
    step("TRUNK", trunkStep(snapshot, subnet)),
    step("DHCP_RELAY", relayStep(snapshot, subnet)),
    step("DHCP_SCOPE", scopeStep(snapshot, subnet)),
    step("DHCP_SERVER", serverStep(snapshot, subnet)),
  ];
}

export function runProbe(tool: ToolId, mode: DiagnosticMode, snapshot: DiagnosticSnapshot, options: { port?: number; name?: string } = {}): ProbeOutcome {
  if (mode === "LIVE") return liveProbe(tool, snapshot.hostname);
  const statement = inventoryProbe(tool, snapshot, options);
  return { tool, available: true, ...statement };
}

function liveProbe(tool: ToolId, hostname: string): ProbeOutcome {
  return {
    tool,
    available: false,
    fact: `La sonde ${tool} vers ${hostname} n'a pas été exécutée.`,
    observation: LIVE_MESSAGE[tool],
    possibleCause: "Sans mesure, la cause reste indéterminée.",
    recommendedCheck: "Utiliser la lecture d'inventaire, qui est un enregistrement et non une mesure.",
  };
}

function inventoryProbe(tool: ToolId, snapshot: DiagnosticSnapshot, options: { port?: number; name?: string }): Statement {
  const address = primaryAddress(snapshot);
  if (tool === "PING") return pingInventory(snapshot);
  if (tool === "TRACEROUTE") return tracerouteInventory(snapshot, address);
  if (tool === "DNS") return dnsInventory(snapshot, options.name);
  if (tool === "TCP") return tcpInventory(snapshot, address);
  if (tool === "ARP") return arpInventory(snapshot, address);
  if (tool === "ROUTE") return routeInventory(snapshot, address);
  if (tool === "HTTP") return httpInventory(snapshot);
  return portInventory(snapshot, options.port ?? 0);
}

function clientStep(snapshot: DiagnosticSnapshot): Statement {
  const addresses = recordedAddresses(snapshot);
  if (addresses.length === 0) {
    return {
      fact: `Aucune adresse IP n'est enregistrée pour ${snapshot.hostname}.`,
      observation: `Le statut enregistré est ${snapshot.status}. Aucune adresse n'a été observée sur le poste.`,
      possibleCause: cause("Le poste peut ne pas avoir reçu d'adresse."),
      recommendedCheck: "Contrôler l'interface avant de conclure à l'absence d'adresse.",
    };
  }
  const down = snapshot.interfaces.filter((item) => item.status !== "UP");
  return {
    fact: `L'adresse ${addresses.join(", ")} est enregistrée pour ${snapshot.hostname}. Le statut de l'équipement est ${snapshot.status}.`,
    observation: down.length
      ? `L'interface ${down.map((item) => `${item.name} (${item.status})`).join(", ")} est enregistrée hors service. Aucune adresse n'a été observée sur le poste.`
      : "Les interfaces enregistrées sont UP. Aucune adresse n'a été observée sur le poste.",
    possibleCause: cause("L'adresse enregistrée peut ne pas être présente sur le poste."),
    recommendedCheck: "Comparer l'adresse enregistrée et celle présente sur l'interface, sans traiter l'enregistrement comme une mesure.",
  };
}

function interfaceStep(snapshot: DiagnosticSnapshot): Statement {
  if (snapshot.interfaces.length === 0) {
    return {
      fact: `Aucune interface n'est enregistrée pour ${snapshot.hostname}.`,
      observation: "Le guide ne dispose d'aucun statut d'interface à lire.",
      possibleCause: cause("L'absence d'interface enregistrée peut masquer le point de raccordement."),
      recommendedCheck: "Enregistrer l'interface du poste, puis relire cette étape.",
    };
  }
  const listed = snapshot.interfaces.map((item) => `${item.name} ${item.status}`).join(", ");
  return {
    fact: `Les interfaces enregistrées de ${snapshot.hostname} sont : ${listed}.`,
    observation: "Ces statuts viennent de l'inventaire. Les interfaces n'ont pas été lues sur l'équipement.",
    possibleCause: cause("Un lien inactif peut empêcher l'obtention d'une adresse."),
    recommendedCheck: "Vérifier le câblage prévu et le statut enregistré de l'interface.",
  };
}

function switchPortStep(snapshot: DiagnosticSnapshot, subnet: DiagnosticSubnet | null): Statement {
  if (snapshot.connectedPorts.length > 0) {
    const port = snapshot.connectedPorts[0];
    const vlan = port.accessVlan ? `VLAN ${port.accessVlan.vid}` : port.mode;
    return {
      fact: `Le port ${port.name} de ${port.switchHostname} est relié à ${snapshot.hostname}. Mode ${port.mode}, statut ${port.status}, ${vlan}.`,
      observation: "Cette liaison est enregistrée. Le lien physique n'a pas été observé.",
      possibleCause: cause("Le statut du port peut différer de l'enregistrement."),
      recommendedCheck: `Relire le port ${port.name} avant d'interpréter la commutation.`,
    };
  }
  const candidate = subnet
    ? snapshot.sitePorts.find((port) => port.mode === "ACCESS" && !port.connectedHostname && port.accessVlan?.vid === subnet.vlan.vid)
    : undefined;
  return {
    fact: `Aucun port de commutation n'est relié à ${snapshot.hostname}.`,
    observation: candidate
      ? `Le port ${candidate.name} de ${candidate.switchHostname} est enregistré en accès sur le VLAN ${candidate.accessVlan?.vid}, sans équipement relié. Cela n'établit pas que le poste y est branché.`
      : "Aucun port d'accès libre du même VLAN n'est enregistré.",
    possibleCause: cause("Le poste peut être prévu sur un port qui n'est pas encore relié dans l'inventaire."),
    recommendedCheck: "Identifier le port physique et l'enregistrer avant d'interpréter la commutation.",
  };
}

function vlanStep(snapshot: DiagnosticSnapshot, address: string | null, subnet: DiagnosticSubnet | null): Statement {
  if (address && subnet) {
    return {
      fact: `L'adresse ${address} appartient au sous-réseau ${subnet.cidr}, relié au VLAN ${subnet.vlan.vid} ${subnet.vlan.name}.`,
      observation: "Ce rattachement vient de l'adressage. Le VLAN annoncé sur le lien n'a pas été observé.",
      possibleCause: cause("Le VLAN d'accès du port peut différer de ce sous-réseau."),
      recommendedCheck: "Comparer le VLAN du port et le VLAN du sous-réseau.",
    };
  }
  return {
    fact: address
      ? `L'adresse ${address} de ${snapshot.hostname} ne tombe dans aucun sous-réseau enregistré du site.`
      : `Aucun sous-réseau ne peut être associé à ${snapshot.hostname}, faute d'adresse enregistrée.`,
    observation: "La recherche porte sur l'adressage local. Aucun VLAN n'a été observé sur un lien.",
    possibleCause: cause("Le VLAN du poste peut ne pas être celui qui est documenté."),
    recommendedCheck: "Rattacher l'adresse à un sous-réseau et à un VLAN avant de poursuivre.",
  };
}

function trunkStep(snapshot: DiagnosticSnapshot, subnet: DiagnosticSubnet | null): Statement {
  if (!subnet) {
    return {
      fact: "Le VLAN du poste n'est pas déterminé dans l'inventaire.",
      observation: "Aucun trunk ne peut être comparé à un VLAN inconnu.",
      possibleCause: cause("Un trunk peut ne pas transporter le VLAN utile."),
      recommendedCheck: "Déterminer le VLAN, puis contrôler les trunks du site.",
    };
  }
  const trunks = snapshot.sitePorts
    .filter((port) => port.mode === "TRUNK" && port.allowedVlans.some((vlan) => vlan.vid === subnet.vlan.vid))
    .sort((left, right) => `${left.switchHostname}/${left.name}`.localeCompare(`${right.switchHostname}/${right.name}`));
  if (trunks.length === 0) {
    return {
      fact: `Aucun trunk du site n'autorise le VLAN ${subnet.vlan.vid}.`,
      observation: "Cette absence concerne l'inventaire. Le transport du VLAN n'a pas été mesuré.",
      possibleCause: cause("Le VLAN peut ne pas être transporté jusqu'au port d'accès."),
      recommendedCheck: `Vérifier la liste des VLAN autorisés sur les trunks du site pour le VLAN ${subnet.vlan.vid}.`,
    };
  }
  const listed = trunks.slice(0, 3).map((port) => `${port.name} de ${port.switchHostname}`).join(", ");
  return {
    fact: `Les trunks enregistrés qui autorisent le VLAN ${subnet.vlan.vid} comprennent : ${listed}.`,
    observation: "L'autorisation est enregistrée. Le transport effectif du VLAN n'a pas été mesuré.",
    possibleCause: cause("Le VLAN peut manquer sur un trunk situé sur le chemin."),
    recommendedCheck: `Contrôler les trunks qui doivent transporter le VLAN ${subnet.vlan.vid}.`,
  };
}

function relayStep(snapshot: DiagnosticSnapshot, subnet: DiagnosticSubnet | null): Statement {
  if (!subnet) {
    return {
      fact: "Aucun sous-réseau n'est déterminé pour chercher un relais DHCP.",
      observation: "Aucun message DHCP n'a été observé.",
      possibleCause: cause("Un relais peut manquer sur la passerelle du VLAN."),
      recommendedCheck: "Déterminer le sous-réseau, puis chercher le helper enregistré.",
    };
  }
  if (subnet.relays.length > 0) {
    const relay = subnet.relays[0];
    return {
      fact: `Un relais DHCP vers ${relay.helperAddress} (${relay.serverName}) est enregistré pour ${subnet.cidr}.`,
      observation: "Le relais est un enregistrement. Aucune requête DHCP n'a été vue.",
      possibleCause: cause("L'adresse d'aide peut être injoignable."),
      recommendedCheck: "Contrôler l'adresse d'aide et l'interface de passerelle enregistrées.",
    };
  }
  const other = snapshot.subnets.find((item) => item.cidr !== subnet.cidr && item.relays.length > 0);
  return {
    fact: `Aucun relais DHCP n'est enregistré pour ${subnet.cidr}.`,
    observation: other
      ? `Un relais est enregistré pour ${other.cidr}, pas pour ce sous-réseau. Aucune requête DHCP n'a été vue.`
      : "Aucun relais DHCP n'est enregistré sur le site. Aucune requête DHCP n'a été vue.",
    possibleCause: cause("Une requête DHCP de ce VLAN peut ne pas être relayée."),
    recommendedCheck: `Contrôler le helper sur la passerelle du VLAN ${subnet.vlan.vid}.`,
  };
}

function scopeStep(snapshot: DiagnosticSnapshot, subnet: DiagnosticSubnet | null): Statement {
  if (!subnet) {
    return {
      fact: "Aucun sous-réseau n'est déterminé pour chercher un scope DHCP.",
      observation: "Aucune offre DHCP n'a été observée.",
      possibleCause: cause("Un scope peut manquer pour le réseau du poste."),
      recommendedCheck: "Déterminer le sous-réseau, puis vérifier qu'un scope activé le couvre.",
    };
  }
  if (subnet.scope?.enabled) {
    return {
      fact: `Un scope DHCP activé est enregistré pour ${subnet.cidr}, porté par ${subnet.scope.serverName}.`,
      observation: "Le scope est un enregistrement. Aucune offre n'a été observée.",
      possibleCause: cause("Le scope peut ne pas contenir d'adresse disponible."),
      recommendedCheck: "Contrôler les plages, les exclusions et les réservations de ce scope.",
    };
  }
  const other = snapshot.subnets.find((item) => item.scope?.enabled && item.cidr !== subnet.cidr);
  return {
    fact: `Aucun scope DHCP n'est enregistré pour ${subnet.cidr}.`,
    observation: other
      ? `Un scope activé existe pour ${other.cidr}. Aucune offre n'a été observée pour ce sous-réseau.`
      : "Aucun scope DHCP activé n'est enregistré sur le site.",
    possibleCause: cause("Le poste peut ne pas recevoir d'offre DHCP."),
    recommendedCheck: "Vérifier qu'un scope activé couvre le sous-réseau du VLAN.",
  };
}

function serverStep(snapshot: DiagnosticSnapshot, subnet: DiagnosticSubnet | null): Statement {
  const named = subnet?.scope?.serverName ?? subnet?.relays[0]?.serverName;
  const server = snapshot.dhcpServers.find((item) => item.name === named) ?? snapshot.dhcpServers[0];
  if (!server) {
    return {
      fact: "Aucun serveur DHCP n'est enregistré pour le site.",
      observation: "Le service DHCP n'a pas été interrogé.",
      possibleCause: cause("Le service peut être absent ou injoignable."),
      recommendedCheck: "Enregistrer le serveur prévu, puis contrôler son statut sans le prendre pour une mesure.",
    };
  }
  const link = named ? `Il est cité pour ce sous-réseau.` : "Il n'est pas cité par un scope ou un relais de ce sous-réseau.";
  return {
    fact: `Le serveur ${server.name} est enregistré ${server.status}${server.address ? ` à l'adresse ${server.address}` : ""}. ${link}`,
    observation: "Ce statut est un enregistrement. Le service DHCP n'a pas été interrogé.",
    possibleCause: cause("Le service peut être injoignable ou ne pas servir ce sous-réseau."),
    recommendedCheck: "Contrôler le serveur désigné par le scope ou le relais, sans conclure à partir du statut seul.",
  };
}

function pingInventory(snapshot: DiagnosticSnapshot): Statement {
  const address = primaryAddress(snapshot);
  const interfaces = snapshot.interfaces.map((item) => `${item.name} ${item.status}`).join(", ");
  return {
    fact: address
      ? `${snapshot.hostname} est enregistré ${snapshot.status} avec l'adresse ${address}.`
      : `${snapshot.hostname} est enregistré ${snapshot.status} sans adresse IP.`,
    observation: `Aucun écho ICMP n'a été mesuré.${interfaces ? ` Interfaces enregistrées : ${interfaces}.` : ""}`,
    possibleCause: cause("L'état enregistré de l'interface peut correspondre à une absence de réponse."),
    recommendedCheck: "Lire le statut d'interface enregistré avant d'envisager une sonde ICMP.",
  };
}

function tracerouteInventory(snapshot: DiagnosticSnapshot, address: string | null): Statement {
  const hop = plannedHop(snapshot, address);
  return {
    fact: hop ?? `Aucun prochain saut enregistré pour ${snapshot.hostname}.`,
    observation: "Aucun traceroute n'a été exécuté. Le chemin affiché est celui de l'inventaire.",
    possibleCause: cause("Le chemin réel peut différer de cette passerelle."),
    recommendedCheck: "Comparer la passerelle enregistrée et la route prévue du routeur.",
  };
}

function dnsInventory(snapshot: DiagnosticSnapshot, name: string | undefined): Statement {
  const query = (name?.trim() || snapshot.hostname).toLowerCase();
  const address = primaryAddress(snapshot);
  const byName = snapshot.dnsRecords.filter((record) => record.name.toLowerCase() === query || `${record.name}.${record.zone}`.toLowerCase() === query);
  const byAddress = address ? snapshot.dnsRecords.filter((record) => record.rdata === address) : [];
  const published = byName.map((record) => `${record.name}.${record.zone} ${record.type} ${record.rdata}`).join(", ");
  const related = byAddress.map((record) => `${record.name}.${record.zone} ${record.type} ${record.rdata}`).join(", ");
  return {
    fact: published
      ? `La zone locale publie ${published}.`
      : `Aucun enregistrement local ne porte le nom ${query}.${related ? ` L'adresse est publiée par ${related}.` : ""}`,
    observation: "Aucun serveur DNS externe n'a été interrogé.",
    possibleCause: cause("Le nom demandé peut différer du nom publié."),
    recommendedCheck: "Chercher le nom dans les zones locales et le PTR de l'adresse.",
  };
}

function tcpInventory(snapshot: DiagnosticSnapshot, address: string | null): Statement {
  return {
    fact: address
      ? `L'adresse ${address} de ${snapshot.hostname} fait partie de l'inventaire.`
      : `${snapshot.hostname} n'a pas d'adresse enregistrée pour un test TCP.`,
    observation: "Aucune connexion TCP n'a été ouverte.",
    possibleCause: cause("Un filtrage peut exister."),
    recommendedCheck: "Lire les règles prévues vers cette adresse avant un test de port.",
  };
}

function arpInventory(snapshot: DiagnosticSnapshot, address: string | null): Statement {
  const match = snapshot.interfaces.find((item) => item.ipAddress && item.ipAddress === address && item.macAddress);
  return {
    fact: match
      ? `L'adresse MAC ${match.macAddress} est enregistrée sur ${match.name} pour ${address}.`
      : `Aucune adresse MAC n'est enregistrée pour ${address ?? snapshot.hostname}.`,
    observation: "La table ARP de l'équipement n'a pas été lue.",
    possibleCause: cause("L'association enregistrée peut différer du cache ARP."),
    recommendedCheck: "Comparer l'adresse MAC enregistrée et celle attendue sur le port.",
  };
}

function routeInventory(snapshot: DiagnosticSnapshot, address: string | null): Statement {
  const hop = plannedHop(snapshot, address);
  return {
    fact: hop ?? `Aucune route enregistrée ne couvre ${address ?? snapshot.hostname}.`,
    observation: "Cette lecture vient de l'inventaire. La table de l'équipement n'a pas été consultée.",
    possibleCause: cause("Une route plus spécifique peut exister sur l'équipement."),
    recommendedCheck: "Comparer cette entrée avec la table de routage prévue du routeur.",
  };
}

function httpInventory(snapshot: DiagnosticSnapshot): Statement {
  return {
    fact: `Aucun service HTTP n'est déclaré pour ${snapshot.hostname}.`,
    observation: "Aucune requête HTTP n'a été envoyée.",
    possibleCause: cause("Un service peut écouter sans être enregistré."),
    recommendedCheck: "Ne lancer un contrôle HTTP qu'après avoir déclaré le service, et seulement vers un équipement de l'inventaire.",
  };
}

function portInventory(snapshot: DiagnosticSnapshot, port: number): Statement {
  return {
    fact: `Le port ${port} est autorisé pour un diagnostic vers ${snapshot.hostname}. Aucune écoute n'est déclarée.`,
    observation: "Aucun test de port n'a été exécuté.",
    possibleCause: cause("L'écoute de ce port peut être absente."),
    recommendedCheck: "Ne pas étendre ce port autorisé à un balayage d'autres ports.",
  };
}

function plannedHop(snapshot: DiagnosticSnapshot, address: string | null) {
  if (!address) return null;
  const subnet = longestSubnet(snapshot, address);
  const connected = snapshot.layer3
    .filter((item) => item.status === "ACTIVE" && contains(item.cidr, address))
    .sort((left, right) => prefixLength(right.cidr) - prefixLength(left.cidr))[0];
  if (connected && (!subnet || prefixLength(connected.cidr) >= prefixLength(subnet.cidr))) {
    return `La correspondance la plus longue dans l'inventaire est ${connected.cidr} sur ${connected.deviceHostname} (${connected.name}), adresse enregistrée ${connected.address}.`;
  }
  const route = snapshot.routes
    .filter((item) => item.status === "ACTIVE" && contains(item.cidr, address))
    .sort((left, right) => prefixLength(right.cidr) - prefixLength(left.cidr))[0];
  if (!route) return null;
  return `La correspondance la plus longue dans l'inventaire est ${route.cidr} via ${route.gateway ?? "une interface locale"} sur ${route.deviceHostname} (${route.protocol}).`;
}

function step(id: GuideStepId, statement: Statement): GuideStep {
  const label = GUIDE_STEPS.find((item) => item.id === id)?.label ?? id;
  return { step: id, label, available: true, ...statement };
}

function cause(text: string) {
  return `${text} Ce n'est pas établi.`;
}

function recordedAddresses(snapshot: DiagnosticSnapshot) {
  const values = snapshot.interfaces.map((item) => item.ipAddress).filter((item): item is string => Boolean(item));
  if (snapshot.managementIp && !values.includes(snapshot.managementIp)) values.push(snapshot.managementIp);
  return values;
}

function primaryAddress(snapshot: DiagnosticSnapshot) {
  return recordedAddresses(snapshot)[0] ?? null;
}

function longestSubnet(snapshot: DiagnosticSnapshot, address: string) {
  return snapshot.subnets
    .filter((subnet) => contains(subnet.cidr, address))
    .sort((left, right) => prefixLength(right.cidr) - prefixLength(left.cidr))[0] ?? null;
}

function prefixLength(cidr: string) {
  const parsed = parsePrefix(cidr);
  return parsed.ok ? parsed.prefix.prefix : -1;
}

function contains(cidr: string, address: string) {
  const prefix = parsePrefix(cidr);
  const parsed = parseAddress(address);
  if (!prefix.ok || !parsed || prefix.prefix.family !== parsed.family) return false;
  return parsed.value >= prefix.prefix.start && parsed.value <= prefix.prefix.end;
}
