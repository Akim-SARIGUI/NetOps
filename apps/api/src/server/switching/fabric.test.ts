import { describe, expect, it } from "vitest";
import { fabricIssues } from "./fabric";

const vlan = { vid: 20, name: "RH", siteId: "paris", status: "ACTIVE" };

describe("chaîne VLAN", () => {
  it("signale un VLAN actif sans sous-réseau", () => {
    const issues = fabricIssues(vlan, [], [], []);
    expect(issues.map((issue) => issue.code)).toContain("VLAN_WITHOUT_SUBNET");
  });

  it("signale une passerelle hors sous-réseau et un équipement hors plan", () => {
    const issues = fabricIssues(
      vlan,
      [{ cidr: "192.168.20.0/24", gateway: "10.0.0.1", gatewayBound: false, addresses: [] }],
      [
        {
          name: "Gi0/4",
          mode: "ACCESS",
          switchHostname: "sw-access-a",
          switchSiteId: "paris",
          connectedHostname: "ap-hall",
          connectedSiteId: "paris",
          connectedAddresses: ["10.0.0.20"],
        },
      ],
      [],
    );
    expect(issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(["GATEWAY_OUTSIDE", "CONNECTED_OFF_SUBNET"]));
  });

  it("signale un commutateur d'un autre site et un chevauchement", () => {
    const issues = fabricIssues(
      vlan,
      [{ cidr: "192.168.20.0/24", gateway: "192.168.20.1", gatewayBound: true, addresses: [] }],
      [
        {
          name: "Gi0/1",
          mode: "TRUNK",
          switchHostname: "sw-lab",
          switchSiteId: "lab",
          connectedHostname: null,
          connectedSiteId: null,
          connectedAddresses: [],
        },
      ],
      [{ name: "Voisin", cidr: "192.168.20.128/25" }],
    );
    expect(issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(["SITE_MISMATCH", "OVERLAP"]));
  });
});
