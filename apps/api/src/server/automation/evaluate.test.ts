import { describe, expect, it } from "vitest";
import {
  backupReport,
  buildDiff,
  decideApproval,
  deploymentAllowed,
  dryRunReport,
  evaluateCritical,
  executionPlan,
  integrationCatalog,
  kindIsCritical,
  renderTemplate,
  stageError,
  verificationPlan,
} from "./evaluate";

describe("moteur d'automatisation", () => {
  it("génère, compare et refuse de sauter une étape", () => {
    const rendered = renderTemplate("ip route {{destination}} {{gateway}}\n! {{label}}", {
      destination: "10.1.30.0",
      gateway: "10.0.0.3",
      label: "Contrôle",
    });
    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    expect(rendered.config).toContain("ip route 10.1.30.0 10.0.0.3");
    expect(renderTemplate("ip route {{destination}}", { destination: "" }).ok).toBe(false);
    expect(buildDiff("", rendered.config).changed).toBe(true);
    expect(buildDiff(rendered.config, rendered.config).changed).toBe(false);
    expect(evaluateCritical(true, true)).toBe(true);
    expect(evaluateCritical(true, false)).toBe(false);
    expect(evaluateCritical(false, true)).toBe(false);
    expect(stageError("DESIRED", "DEPLOYMENT")).toContain("n'est pas la suivante");
    expect(stageError("BACKUP", "DEPLOYMENT")).toBeNull();
  });

  it("n'applique une modification critique qu'avec une autorisation ou une politique", () => {
    expect(decideApproval({ critical: true, authorize: false, automaticCritical: false }).ok).toBe(false);
    expect(decideApproval({ critical: true, authorize: true, automaticCritical: false })).toMatchObject({ authorization: "EXPLICIT" });
    expect(decideApproval({ critical: true, authorize: false, automaticCritical: true })).toMatchObject({ authorization: "POLICY" });
    expect(decideApproval({ critical: false, authorize: false, automaticCritical: false })).toMatchObject({ authorization: "WORKFLOW" });
    expect(deploymentAllowed(true, "NONE")).toBe(false);
    expect(deploymentAllowed(true, "EXPLICIT")).toBe(true);
    expect(kindIsCritical("ROUTING")).toBe(true);
    expect(kindIsCritical("BANNER")).toBe(false);
  });

  it("laisse les intégrations muettes et ne relit pas l'équipement", () => {
    expect(integrationCatalog().filter((item) => item.id !== "SIMULATION").every((item) => item.available === false)).toBe(true);
    expect(executionPlan("SSH")).toMatchObject({ pushed: false, stored: false, deviceQueried: false });
    expect(executionPlan("SNMP").report).toContain("pas au déploiement");
    expect(executionPlan("SIMULATION")).toMatchObject({ pushed: false, stored: true, deviceQueried: false });
    expect(verificationPlan({ stored: true, generated: "config", integration: "SIMULATION" })).toMatchObject({ verified: true, deviceQueried: false });
    expect(verificationPlan({ stored: false, generated: "config", integration: "SSH" }).verified).toBe(false);
    expect(dryRunReport("ANSIBLE", true)).toContain("Aucune commande");
    expect(backupReport("")).toContain("n'a été lue");
  });
});
