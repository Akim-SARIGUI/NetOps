export const MONITORING_NOTICE = "Mesures simulées. Aucun équipement réel n'est interrogé.";
export const COLLECTOR_NOTICE = "Les collecteurs ICMP et SNMP sont préparés. Aucun n'est disponible.";

export const CPU_THRESHOLD = 80;
export const RAM_THRESHOLD = 90;
export const DHCP_THRESHOLD = 80;

export type CollectorId = "SIMULATION" | "ICMP" | "SNMP";
export type MetricKind = "AVAILABILITY" | "CPU" | "RAM" | "INTERFACE" | "TRAFFIC" | "LATENCY" | "PACKET_LOSS" | "UPTIME" | "ERRORS";
export type MetricOrigin = "SIMULATION" | "INVENTORY" | "MEASURED";
export type AlertCode = "DEVICE_DOWN" | "CPU_HIGH" | "RAM_HIGH" | "INTERFACE_DOWN" | "PACKET_LOSS" | "DHCP_POOL" | "DNS_UNAVAILABLE";

export type Sample = {
  kind: MetricKind;
  interfaceName: string | null;
  value: number;
  unit: string;
  origin: MetricOrigin;
};

export type DeviceSnapshot = {
  hostname: string;
  status: string;
  interfaces: Array<{ name: string; status: string; speedMbps: number | null }>;
};

export type CollectResult =
  | { available: true; collector: CollectorId; samples: Sample[] }
  | { available: false; collector: CollectorId; message: string };

const COLLECTORS: Record<Exclude<CollectorId, "SIMULATION">, string> = {
  ICMP: "Le collecteur ICMP n'est pas intégré.",
  SNMP: "Le collecteur SNMP n'est pas intégré.",
};

export function collect(mode: CollectorId, device: DeviceSnapshot): CollectResult {
  if (mode !== "SIMULATION") return { available: false, collector: mode, message: COLLECTORS[mode] };
  return { available: true, collector: "SIMULATION", samples: simulate(device) };
}

export function deviceAlerts(input: {
  hostname: string;
  packetLossThreshold: number;
  samples: Sample[] | null;
  interfaces: Array<{ name: string; status: string }>;
}) {
  const alerts: Array<{ code: AlertCode; severity: "critical"; message: string; interfaceName?: string }> = [];
  for (const iface of input.interfaces) {
    if (iface.status === "UP") continue;
    alerts.push({
      code: "INTERFACE_DOWN",
      severity: "critical",
      interfaceName: iface.name,
      message: `L'interface ${iface.name} de ${input.hostname} est ${iface.status} dans l'inventaire`,
    });
  }
  if (!input.samples) return alerts;
  const availability = sampleValue(input.samples, "AVAILABILITY");
  const cpu = sampleValue(input.samples, "CPU");
  const ram = sampleValue(input.samples, "RAM");
  const loss = sampleValue(input.samples, "PACKET_LOSS");
  if (availability === 0) alerts.push({ code: "DEVICE_DOWN", severity: "critical", message: `${input.hostname} est hors ligne` });
  if (cpu !== null && cpu > CPU_THRESHOLD) alerts.push({ code: "CPU_HIGH", severity: "critical", message: `CPU de ${input.hostname} à ${cpu} %, au-dessus de ${CPU_THRESHOLD} %` });
  if (ram !== null && ram > RAM_THRESHOLD) alerts.push({ code: "RAM_HIGH", severity: "critical", message: `Mémoire de ${input.hostname} à ${ram} %, au-dessus de ${RAM_THRESHOLD} %` });
  if (loss !== null && loss > input.packetLossThreshold) {
    alerts.push({ code: "PACKET_LOSS", severity: "critical", message: `Perte de paquets de ${input.hostname} à ${loss} %, au-dessus de ${input.packetLossThreshold} %` });
  }
  return alerts;
}

export function dhcpAlerts(scopes: Array<{ label: string; utilization: number }>) {
  return scopes
    .filter((scope) => scope.utilization > DHCP_THRESHOLD)
    .map((scope) => ({
      code: "DHCP_POOL" as const,
      severity: "critical" as const,
      message: `Le pool DHCP ${scope.label} est utilisé à ${round(scope.utilization)} %, au-dessus de ${DHCP_THRESHOLD} %`,
    }));
}

export function dnsAlerts(servers: Array<{ name: string; status: string }>) {
  if (servers.some((server) => server.status === "ACTIVE")) return [];
  return [{ code: "DNS_UNAVAILABLE" as const, severity: "critical" as const, message: "Aucun serveur DNS actif n'est disponible" }];
}

export function round(value: number) {
  return Math.round(value * 10) / 10;
}

export function weightedUtilization(items: Array<{ used: number; usable: number }>) {
  const usable = items.reduce((sum, item) => sum + item.usable, 0);
  const used = items.reduce((sum, item) => sum + item.used, 0);
  if (usable <= 0) return 0;
  return round((used / usable) * 100);
}

function sampleValue(samples: Sample[], kind: MetricKind) {
  const sample = samples.find((item) => item.kind === kind && !item.interfaceName);
  return sample ? sample.value : null;
}

function simulate(device: DeviceSnapshot): Sample[] {
  const down = device.status !== "ACTIVE";
  const spread = hash(device.hostname);
  const samples: Sample[] = [
    metric("AVAILABILITY", down ? 0 : 1, "up"),
    metric("CPU", down ? 0 : 15 + (spread % 40), "%"),
    metric("RAM", down ? 0 : 25 + (spread % 45), "%"),
    metric("LATENCY", down ? 0 : 2 + (spread % 15), "ms"),
    metric("PACKET_LOSS", down ? 0 : (spread % 10) / 10, "%"),
    metric("UPTIME", down ? 0 : 86400 * (3 + (spread % 20)), "s"),
    metric("ERRORS", down ? 0 : spread % 3, "count"),
  ];
  for (const iface of device.interfaces) {
    const up = iface.status === "UP";
    samples.push({ kind: "INTERFACE", interfaceName: iface.name, value: up ? 1 : 0, unit: "up", origin: "INVENTORY" });
    const speedBps = (iface.speedMbps ?? 1000) * 1_000_000;
    samples.push({ kind: "TRAFFIC", interfaceName: iface.name, value: down || !up ? 0 : Math.round(speedBps * (0.02 + (spread % 8) / 100)), unit: "bps", origin: "SIMULATION" });
    samples.push({ kind: "ERRORS", interfaceName: iface.name, value: up ? spread % 2 : 0, unit: "count", origin: "SIMULATION" });
  }
  return samples;
}

function metric(kind: MetricKind, value: number, unit: string): Sample {
  return { kind, interfaceName: null, value, unit, origin: "SIMULATION" };
}

function hash(value: string) {
  let total = 0;
  for (const char of value) total = (total * 33 + char.charCodeAt(0)) % 997;
  return total;
}
