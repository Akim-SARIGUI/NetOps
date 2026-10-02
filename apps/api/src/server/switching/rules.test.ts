import { describe, expect, it } from "vitest";
import { issuesForPort, issuesForSwitch, isStructuralIssue, renderSwitchTree, type PortSnapshot } from "./rules";

function port(overrides: Partial<PortSnapshot> = {}): PortSnapshot {
  return {
    id: "p1",
    name: "Gi0/1",
    mode: "ACCESS",
    status: "UP",
    poe: "OFF",
    macAddress: null,
    deviceId: "sw",
    deviceRole: "SWITCH",
    deviceSiteId: "site",
    deviceOrganizationId: "org",
    accessVlan: { id: "v10", vid: 10, siteId: "site", status: "ACTIVE", name: "Utilisateurs" },
    nativeVlan: null,
    allowedVlans: [],
    connectedDeviceId: null,
    connectedOrganizationId: null,
    ...overrides,
  };
}

describe("commutation", () => {
  it("dessine l'arbre d'un commutateur", () => {
    const tree = renderSwitchTree("sw-access-a", [
      port({ id: "a", name: "Gi0/3" }),
      port({
        id: "b",
        name: "Gi0/1",
        mode: "TRUNK",
        accessVlan: null,
        allowedVlans: [port().accessVlan!],
      }),
      port({ id: "c", name: "Gi0/2", accessVlan: { id: "v20", vid: 20, siteId: "site", status: "ACTIVE", name: "Voix" } }),
    ]);
    expect(tree).toBe(["sw-access-a", "├── Gi0/1 → TRUNK", "├── Gi0/2 → VLAN 20", "└── Gi0/3 → VLAN 10"].join("\n"));
  });

  it("exige un seul VLAN sur un port access", () => {
    const issues = issuesForPort(port({ accessVlan: null }));
    expect(issues.map((issue) => issue.code)).toContain("ACCESS_WITHOUT_VLAN");
    expect(isStructuralIssue("ACCESS_WITHOUT_VLAN")).toBe(true);
  });

  it("refuse une liste de VLAN sur un port access", () => {
    const issues = issuesForPort(port({ allowedVlans: [port().accessVlan!] }));
    expect(issues.map((issue) => issue.code)).toContain("ACCESS_HAS_ALLOWED");
  });

  it("exige des VLAN autorisés sur un trunk et un natif inclus", () => {
    const native = { id: "v99", vid: 99, siteId: "site", status: "ACTIVE", name: "Natif" };
    const empty = issuesForPort(port({ mode: "TRUNK", accessVlan: null, allowedVlans: [] }));
    expect(empty.map((issue) => issue.code)).toContain("TRUNK_WITHOUT_ALLOWED");
    const missingNative = issuesForPort(
      port({
        mode: "TRUNK",
        accessVlan: null,
        nativeVlan: native,
        allowedVlans: [port().accessVlan!],
      }),
    );
    expect(missingNative.map((issue) => issue.code)).toContain("NATIVE_NOT_ALLOWED");
  });

  it("signale un VLAN déprécié et une MAC dupliquée sans bloquer la structure", () => {
    const first = port({ macAddress: "aa:bb:cc:dd:ee:01", accessVlan: { ...port().accessVlan!, status: "DEPRECATED" } });
    const second = port({ id: "p2", name: "Gi0/2", macAddress: "aa:bb:cc:dd:ee:01" });
    const issues = issuesForSwitch([first, second]);
    expect(issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(["VLAN_NOT_ACTIVE", "DUPLICATE_MAC"]));
    expect(isStructuralIssue("VLAN_NOT_ACTIVE")).toBe(false);
  });
});
