import { describe, expect, it } from "vitest";
import { inventoryLinks, layoutNodes, refuseDiscovery } from "./evaluate";

describe("topologie", () => {
  it("place les rôles réels et garde Internet à part", () => {
    const placed = layoutNodes([
      { id: "fw", role: "FIREWALL", label: "fw-edge" },
      { id: "core", role: "ROUTER", label: "core-paris" },
      { id: "sw", role: "SWITCH", label: "sw-access-a" },
      { id: "net", role: "INTERNET", label: "Internet" },
    ], new Map([["net", { x: 80, y: 160 }]]));
    expect(placed.find((node) => node.id === "net")).toMatchObject({ x: 80, y: 160, placed: true });
    expect(placed.find((node) => node.id === "core")?.x).toBe(500);
    expect(placed.find((node) => node.id === "sw")?.placed).toBe(false);
  });

  it("lit le seul lien réellement raccordé et laisse le trafic vide", () => {
    const links = inventoryLinks([{
      id: "port",
      name: "Gi0/4",
      status: "UP",
      mode: "ACCESS",
      speedMbps: 1000,
      device: { id: "sw", hostname: "sw-access-a" },
      connectedDevice: { id: "ap", hostname: "ap-hall", interfaces: [{ name: "eth0" }] },
      accessVlan: { id: "vlan", vid: 20, name: "Voix" },
      nativeVlan: null,
    }]);
    expect(links).toEqual([{
      id: "inventory:port",
      derived: true,
      origin: "INVENTORY",
      simulated: false,
      sourceId: "sw",
      targetId: "ap",
      sourcePort: "Gi0/4",
      targetPort: "eth0",
      speedMbps: 1000,
      status: "UP",
      vlan: { id: "vlan", vid: 20, name: "Voix" },
      trafficBps: null,
    }]);
    expect(refuseDiscovery().status).toBe(422);
  });
});
