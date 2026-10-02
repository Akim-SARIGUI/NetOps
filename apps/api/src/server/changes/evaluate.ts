import { buildDiff, executionPlan, type IntegrationId } from "../automation/evaluate";

export const CHANGE_NOTICE = "Gestion des changements simulée. Aucune configuration n'est lue ni envoyée sur un équipement.";
export const BACKUP_NOTICE = "Sauvegarde locale. Aucune configuration n'a été lue sur l'équipement.";
export const INCIDENT_SUMMARY = "Déploiement en échec. Le rollback local est vérifié. Aucun équipement n'a été modifié.";

export const PHASES = ["OPEN", "BACKED_UP", "DEPLOYED", "VERIFIED", "FAILED", "ROLLED_BACK", "ROLLBACK_VERIFIED", "INCIDENT"] as const;
export type Phase = (typeof PHASES)[number];
export type ChangeAction = "backup" | "deploy" | "verify" | "rollback" | "verifyRollback" | "incident";

const EXPECTED: Record<ChangeAction, Phase> = {
  backup: "OPEN",
  deploy: "BACKED_UP",
  verify: "DEPLOYED",
  rollback: "FAILED",
  verifyRollback: "ROLLED_BACK",
  incident: "ROLLBACK_VERIFIED",
};

const GATE: Record<ChangeAction, string> = {
  backup: "La sauvegarde doit précéder le changement.",
  deploy: "Le changement exige une sauvegarde préalable.",
  verify: "La vérification suit un déploiement enregistré. Un échec se poursuit par un rollback.",
  rollback: "Le rollback suit un déploiement en échec.",
  verifyRollback: "La vérification du rollback suit le rollback.",
  incident: "L'incident suit la vérification du rollback.",
};

const IPV4 = /^(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const IPV6 = /^[0-9a-fA-F:]{2,39}$/;

export function clientAddress(header: string | null) {
  const first = header?.split(",")[0]?.trim() ?? "";
  if (IPV4.test(first) || (first.includes(":") && IPV6.test(first))) return first;
  return "127.0.0.1";
}

export function gate(current: Phase, action: ChangeAction) {
  if (current === EXPECTED[action]) return null;
  return GATE[action];
}

export function baseline(previous: string) {
  return previous.trim() ? previous : "! aucune configuration rendue";
}

export function deploymentOutcome(integration: IntegrationId) {
  const plan = executionPlan(integration);
  if (plan.stored) return { phase: "DEPLOYED" as const, result: "STORED" as const, pushed: false, report: plan.report };
  return { phase: "FAILED" as const, result: "FAILED" as const, pushed: false, report: plan.report };
}

export function verifyStored(actual: string, expected: string) {
  const ok = actual === expected;
  return {
    ok,
    deviceQueried: false as const,
    report: ok
      ? "La version enregistrée correspond. L'équipement n'a pas été relu."
      : "La version enregistrée ne correspond pas. L'équipement n'a pas été relu.",
  };
}

export function configurationDiff(previous: string, next: string) {
  return buildDiff(previous, next).text;
}
