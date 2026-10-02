import { describe, expect, it } from "vitest";
import { interVlanPaths, networkIssue, prepareRoute } from "./evaluate";

const connected = [
  { cidr: "10.0.0.0/24", address: "10.0.0.1", interfaceId: "gi00", name: "Gi0/0" },
  { cidr: "10.1.10.0/24", address: "10.1.10.1", interfaceId: "vlan10", name: "Vlan10" },
  { cidr: "10.0.1.0/24", address: "10.0.1.1", interfaceId: "gi01", name: "Gi0/1" },
];

describe("routes", () => {
  it("accepte une statique et une route par défaut joignables", () => {
    const staticRoute = prepareRoute({ protocol: "STATIC", cidr: "10.1.30.0/24", gateway: "10.0.0.3" }, connected, []);
    expect(staticRoute.ok && staticRoute.cidr).toBe("10.1.30.0/24");
    const fallback = prepareRoute({ protocol: "DEFAULT", cidr: "0.0.0.0/0", gateway: "10.0.0.3" }, connected, []);
    expect(fallback.ok && fallback.protocol).toBe("DEFAULT");
  });

  it("refuse une route invalide, une passerelle inaccessible, un conflit et OSPF", () => {
    expect(prepareRoute({ protocol: "STATIC", cidr: "10.1.30.5/24", gateway: "10.0.0.3" }, connected, []).ok).toBe(false);
    expect(prepareRoute({ protocol: "STATIC", cidr: "10.1.30.0/24", gateway: "192.0.2.1" }, connected, []).ok).toBe(false);
    expect(prepareRoute({ protocol: "STATIC", cidr: "10.9.0.0/16", gateway: "10.0.0.3" }, connected, ["10.9.0.0/16"]).ok).toBe(false);
    expect(prepareRoute({ protocol: "OSPF", cidr: "10.1.30.0/24", gateway: "10.0.0.3" }, connected, []).ok).toBe(false);
    expect(networkIssue("198.51.100.0/24", ["10.0.0.0/16", "10.1.0.0/16"])?.code).toBe("NETWORK_UNKNOWN");
    expect(networkIssue("10.1.30.0/24", ["10.1.0.0/16"])).toBeNull();
  });

  it("relie le VLAN 10 au VLAN 40 par le routeur", () => {
    const router = { id: "core", hostname: "core-paris" };
    const paths = interVlanPaths([
      { vlan: { id: "v10", vid: 10, name: "Utilisateurs" }, address: "10.1.10.1", name: "Vlan10", kind: "SVI", device: router },
      { vlan: { id: "v40", vid: 40, name: "Transit" }, address: "10.0.1.1", name: "Gi0/1", kind: "PHYSICAL", device: router },
    ]);
    expect(paths).toHaveLength(1);
    expect(paths[0]?.from.vlan.vid).toBe(10);
    expect(paths[0]?.from.address).toBe("10.1.10.1");
    expect(paths[0]?.router.hostname).toBe("core-paris");
    expect(paths[0]?.to.vlan.vid).toBe(40);
  });
});
