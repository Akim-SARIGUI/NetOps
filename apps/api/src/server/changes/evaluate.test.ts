import { describe, expect, it } from "vitest";
import { baseline, clientAddress, configurationDiff, deploymentOutcome, gate, verifyStored } from "./evaluate";

describe("gestion des changements", () => {
  it("impose la sauvegarde avant le changement et l'incident après le rollback", () => {
    expect(gate("OPEN", "deploy")).toContain("sauvegarde préalable");
    expect(gate("BACKED_UP", "deploy")).toBeNull();
    expect(gate("FAILED", "verify")).toContain("rollback");
    expect(gate("FAILED", "rollback")).toBeNull();
    expect(gate("ROLLBACK_VERIFIED", "incident")).toBeNull();
    expect(gate("OPEN", "incident")).toContain("incident");
  });

  it("échoue les intégrations réelles et ne relit pas l'équipement", () => {
    expect(deploymentOutcome("SIMULATION")).toMatchObject({ phase: "DEPLOYED", result: "STORED", pushed: false });
    expect(deploymentOutcome("SSH")).toMatchObject({ phase: "FAILED", result: "FAILED", pushed: false });
    expect(verifyStored("route", "route")).toMatchObject({ ok: true, deviceQueried: false });
    expect(verifyStored("a", "b").ok).toBe(false);
    expect(baseline("")).toContain("aucune configuration");
    expect(configurationDiff("a", "b")).toContain("+ b");
    expect(clientAddress("203.0.113.44, 10.0.0.1")).toBe("203.0.113.44");
    expect(clientAddress("n'importe quoi")).toBe("127.0.0.1");
  });
});
