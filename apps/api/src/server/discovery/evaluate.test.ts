import { describe, expect, it } from "vitest";
import { classify, decisionError, probe, simulateObservations, type InventoryRecord } from "./evaluate";

const inventory: InventoryRecord[] = [
  { id: "core", hostname: "core-paris", managementIp: "10.0.0.1", macAddresses: ["00:11:22:33:44:55"] },
];

describe("découverte simulée", () => {
  it("classe les quatre résultats et laisse les connecteurs réels muets", () => {
    const findings = simulateObservations(inventory);
    expect(findings.map((item) => item.verdict)).toEqual(["MATCHED", "DISCOVERED", "UNKNOWN", "CONFLICT"]);
    expect(findings.find((item) => item.verdict === "DISCOVERED")).toMatchObject({ hostname: "sw-nouveau", ipAddress: "10.9.0.10" });
    expect(findings.find((item) => item.verdict === "CONFLICT")?.conflictReason).toContain("core-paris");
    expect(findings.every((item) => item.simulated)).toBe(true);
    expect(probe("ICMP")).toMatchObject({ available: false });
    expect(probe("SSH").message).toContain("n'est pas intégré");
    expect(probe("SIMULATION").available).toBe(true);
  });

  it("n'accepte ni un conflit ni une identité incomplète", () => {
    expect(classify({ hostname: null, ipAddress: "10.9.0.50", macAddress: null, role: null, interfaces: [], ports: [], vlans: [], neighbors: [] }, inventory).verdict).toBe("UNKNOWN");
    expect(decisionError("CONFLICT", "ACCEPTED")).toContain("ne peut pas être accepté");
    expect(decisionError("UNKNOWN", "ACCEPTED")).toContain("inconnue");
    expect(decisionError("DISCOVERED", "ACCEPTED")).toBeNull();
    expect(decisionError("MATCHED", "ACCEPTED")).toBeNull();
    expect(decisionError("CONFLICT", "REJECTED")).toBeNull();
  });
});
