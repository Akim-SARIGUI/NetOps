import { describe, expect, it } from "vitest";
import { authorizePort, guide, runProbe, type DiagnosticSnapshot } from "./evaluate";

const reception: DiagnosticSnapshot = {
  hostname: "pc-accueil",
  role: "CLIENT",
  status: "PLANNED",
  managementIp: "10.1.10.25",
  interfaces: [{ name: "eth0", ipAddress: "10.1.10.25", macAddress: "00:1a:2b:3c:4d:51", status: "DOWN" }],
  connectedPorts: [],
  sitePorts: [
    {
      name: "Gi0/1",
      switchHostname: "sw-access-a",
      status: "UP",
      mode: "TRUNK",
      connectedHostname: null,
      accessVlan: null,
      nativeVlan: { vid: 99, name: "Management" },
      allowedVlans: [{ vid: 10, name: "Utilisateurs" }],
    },
    {
      name: "Gi0/3",
      switchHostname: "sw-access-a",
      status: "UP",
      mode: "ACCESS",
      connectedHostname: null,
      accessVlan: { vid: 10, name: "Utilisateurs" },
      nativeVlan: null,
      allowedVlans: [],
    },
  ],
  subnets: [
    { cidr: "10.1.10.0/24", gateway: "10.1.10.1", vlan: { vid: 10, name: "Utilisateurs" }, relays: [], scope: null },
    {
      cidr: "10.1.20.0/24",
      gateway: "10.1.20.1",
      vlan: { vid: 20, name: "Voix" },
      relays: [{ helperAddress: "10.0.0.10", serverName: "dhcp-paris" }],
      scope: { enabled: true, serverName: "dhcp-paris", serverStatus: "ACTIVE", serverAddress: "10.0.0.10" },
    },
  ],
  layer3: [{ deviceHostname: "core-paris", name: "Vlan10", address: "10.1.10.1", cidr: "10.1.10.0/24", vlanVid: 10, status: "ACTIVE" }],
  routes: [{ deviceHostname: "core-paris", cidr: "0.0.0.0/0", gateway: "10.0.0.3", protocol: "DEFAULT", status: "ACTIVE" }],
  dnsRecords: [{ zone: "entreprise.local", name: "intranet", type: "A", rdata: "10.1.10.25" }],
  dhcpServers: [{ name: "dhcp-paris", status: "ACTIVE", address: "10.0.0.10" }],
};

describe("diagnostic guidé", () => {
  it("sépare le fait, l'observation, la cause possible et le contrôle", () => {
    const steps = guide(reception);
    expect(steps.map((item) => item.label)).toEqual([
      "Client sans IP",
      "Interface",
      "Switch port",
      "VLAN",
      "Trunk",
      "DHCP Relay",
      "DHCP Scope",
      "DHCP Server",
    ]);
    for (const item of steps) {
      expect(item.possibleCause).toMatch(/peut/);
      expect(item.possibleCause).toMatch(/n'est pas établi/);
      expect(item.fact).not.toMatch(/peut/);
      const text = `${item.fact} ${item.observation} ${item.possibleCause} ${item.recommendedCheck}`;
      expect(text).not.toMatch(/la cause est|confirmé|a répondu/);
    }
    expect(steps[0]?.fact).toContain("10.1.10.25");
    expect(steps[5]?.fact).toContain("Aucun relais");
    expect(steps[6]?.fact).toContain("Aucun scope");
    expect(runProbe("ROUTE", "INVENTORY", reception).fact).toContain("10.1.10.0/24");
    expect(runProbe("ROUTE", "INVENTORY", reception).fact).not.toContain("0.0.0.0/0");
  });

  it("n'invente pas une mesure quand la sonde réelle est indisponible", () => {
    const live = runProbe("PING", "LIVE", reception);
    const text = `${live.fact} ${live.observation} ${live.possibleCause} ${live.recommendedCheck}`;
    expect(live.available).toBe(false);
    expect(live.observation).toContain("ICMP");
    expect(text).not.toContain("10.1.10.25");
    expect(text).not.toContain("DOWN");
    expect(authorizePort(445)).toContain("n'est pas autorisé");
    expect(authorizePort(80)).toBeNull();
    expect(runProbe("PORT", "INVENTORY", reception, { port: 80 }).observation).toContain("n'a été exécuté");
  });
});
