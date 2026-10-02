import { describe, expect, it } from "vitest";
import {
  buildScenario,
  fabricEnvironmentError,
  nodeCatalog,
  preparePromotionError,
  promoteError,
  promotionAllowed,
  renderConfiguration,
  scenarioCatalog,
  validatePromotionError,
} from "./evaluate";

describe("mode LAB", () => {
  it("isole une infrastructure et des scénarios hors production", () => {
    const nodes = nodeCatalog();
    const scenarios = scenarioCatalog();
    expect(nodes.map((item) => item.role)).toEqual(["ROUTER", "SWITCH", "FIREWALL", "SERVER", "CLIENT"]);
    expect(scenarios.map((item) => item.kind)).toEqual(["VLAN", "DHCP", "DNS", "ROUTING", "ACL", "CONNECTIVITY"]);
    expect(nodes.every((item) => item.address.startsWith("10.255."))).toBe(true);
    expect(scenarios.every((item) => item.ready && item.observation.includes("production"))).toBe(true);
    expect(fabricEnvironmentError("PRODUCTION")).toContain("LAB");
    expect(fabricEnvironmentError("LAB")).toBeNull();
    const text = renderConfiguration(nodes, scenarios);
    expect(text).toContain("lab-router");
    expect(text).toContain("VLAN 100");
    expect(text).not.toContain("core-paris");
  });

  it("exige LAB → STAGING → PRODUCTION avec validation", () => {
    expect(promotionAllowed("LAB", "STAGING")).toBe(true);
    expect(promotionAllowed("STAGING", "PRODUCTION")).toBe(true);
    expect(promotionAllowed("LAB", "PRODUCTION")).toBe(false);
    expect(promotionAllowed("DEV", "STAGING")).toBe(false);
    expect(
      preparePromotionError({
        fabricEnvironment: "LAB",
        targetEnvironment: "PRODUCTION",
        sourcePromotion: null,
        scenariosReady: true,
      }),
    ).toContain("STAGING");
    expect(
      preparePromotionError({
        fabricEnvironment: "LAB",
        targetEnvironment: "STAGING",
        sourcePromotion: null,
        scenariosReady: false,
      }),
    ).toContain("scénarios");
    expect(validatePromotionError("PREPARED")).toBeNull();
    expect(validatePromotionError("VALIDATED")).toContain("préparée");
    expect(promoteError({ phase: "PREPARED", targetEnvironment: "STAGING", confirmProduction: false })).toContain("validation");
    expect(promoteError({ phase: "VALIDATED", targetEnvironment: "PRODUCTION", confirmProduction: false })).toContain("confirmation");
    expect(promoteError({ phase: "VALIDATED", targetEnvironment: "PRODUCTION", confirmProduction: true })).toBeNull();
    expect(buildScenario("CONNECTIVITY").plan).toContain("lab-client");
  });
});
