import { describe, expect, it } from "vitest";
import { collect, deviceAlerts, dhcpAlerts, dnsAlerts } from "./evaluate";

const active = {
  hostname: "core-paris",
  status: "ACTIVE",
  interfaces: [{ name: "Gi0/0", status: "UP", speedMbps: 1000 }],
};

describe("supervision", () => {
  it("simule un équipement actif et refuse les collecteurs réels", () => {
    const result = collect("SIMULATION", active);
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.samples.find((sample) => sample.kind === "AVAILABILITY")?.value).toBe(1);
    expect(result.samples.find((sample) => sample.kind === "CPU")!.value).toBeLessThanOrEqual(80);
    expect(result.samples.find((sample) => sample.kind === "INTERFACE")?.origin).toBe("INVENTORY");
    expect(collect("ICMP", active)).toMatchObject({ available: false, collector: "ICMP" });
    expect(collect("SNMP", active).available).toBe(false);
  });

  it("déclenche les alertes de seuil", () => {
    const down = deviceAlerts({
      hostname: "pc-accueil",
      packetLossThreshold: 2,
      interfaces: [{ name: "eth0", status: "DOWN" }],
      samples: [
        { kind: "AVAILABILITY", interfaceName: null, value: 0, unit: "up", origin: "SIMULATION" },
        { kind: "CPU", interfaceName: null, value: 81, unit: "%", origin: "SIMULATION" },
        { kind: "RAM", interfaceName: null, value: 91, unit: "%", origin: "SIMULATION" },
        { kind: "PACKET_LOSS", interfaceName: null, value: 2.5, unit: "%", origin: "SIMULATION" },
      ],
    });
    expect(down.map((alert) => alert.code)).toEqual(["INTERFACE_DOWN", "DEVICE_DOWN", "CPU_HIGH", "RAM_HIGH", "PACKET_LOSS"]);
    const calm = deviceAlerts({
      hostname: "core-paris",
      packetLossThreshold: 2,
      interfaces: [{ name: "Gi0/0", status: "UP" }],
      samples: [
        { kind: "AVAILABILITY", interfaceName: null, value: 1, unit: "up", origin: "SIMULATION" },
        { kind: "CPU", interfaceName: null, value: 80, unit: "%", origin: "SIMULATION" },
        { kind: "RAM", interfaceName: null, value: 90, unit: "%", origin: "SIMULATION" },
        { kind: "PACKET_LOSS", interfaceName: null, value: 2, unit: "%", origin: "SIMULATION" },
      ],
    });
    expect(calm).toEqual([]);
    expect(dhcpAlerts([{ label: "10.1.20.0/24", utilization: 80 }])).toEqual([]);
    expect(dhcpAlerts([{ label: "10.1.20.0/24", utilization: 81 }])[0]?.code).toBe("DHCP_POOL");
    expect(dnsAlerts([{ name: "dns-paris", status: "ACTIVE" }])).toEqual([]);
    expect(dnsAlerts([{ name: "dns-paris", status: "PLANNED" }])[0]?.code).toBe("DNS_UNAVAILABLE");
  });
});
