export const AUTOMATION_NOTICE = "Automatisation simulée. Aucune configuration n'est envoyée à un équipement.";
export const INTEGRATION_NOTICE = "Les intégrations SSH, Ansible, API constructeur et SNMP sont préparées. Aucune n'est disponible.";

export const STAGES = ["DESIRED", "VALIDATION", "GENERATE", "DIFF", "DRY_RUN", "APPROVAL", "BACKUP", "DEPLOYMENT", "VERIFICATION"] as const;
export const INTEGRATIONS = ["SIMULATION", "SSH", "ANSIBLE", "VENDOR_API", "SNMP"] as const;
export const KINDS = ["BANNER", "INTERFACE", "VLAN", "ROUTING", "FIREWALL"] as const;
export const AUTHORIZATIONS = ["NONE", "EXPLICIT", "POLICY", "WORKFLOW"] as const;

export type Stage = (typeof STAGES)[number];
export type IntegrationId = (typeof INTEGRATIONS)[number];
export type TemplateKind = (typeof KINDS)[number];
export type Authorization = (typeof AUTHORIZATIONS)[number];

export type IntegrationInfo = { id: IntegrationId; available: boolean; message: string };

const PREVIOUS: Record<Exclude<Stage, "DESIRED">, Stage> = {
  VALIDATION: "DESIRED",
  GENERATE: "VALIDATION",
  DIFF: "GENERATE",
  DRY_RUN: "DIFF",
  APPROVAL: "DRY_RUN",
  BACKUP: "APPROVAL",
  DEPLOYMENT: "BACKUP",
  VERIFICATION: "DEPLOYMENT",
};

function markerPattern() {
  return /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g;
}

const UNAVAILABLE: Record<Exclude<IntegrationId, "SIMULATION">, string> = {
  SSH: "Le connecteur SSH n'est pas intégré.",
  ANSIBLE: "Le connecteur Ansible n'est pas intégré.",
  VENDOR_API: "L'API constructeur n'est pas intégrée.",
  SNMP: "Le connecteur SNMP n'est pas intégré. Il servirait à la vérification, pas au déploiement.",
};

export function kindIsCritical(kind: TemplateKind) {
  return kind !== "BANNER";
}

export function integrationCatalog(): IntegrationInfo[] {
  return INTEGRATIONS.map((id) =>
    id === "SIMULATION" ? { id, available: true, message: AUTOMATION_NOTICE } : { id, available: false, message: UNAVAILABLE[id] },
  );
}

export function stageError(current: Stage, target: Exclude<Stage, "DESIRED">) {
  if (current === PREVIOUS[target]) return null;
  return "Cette étape n'est pas la suivante du workflow. Aucune modification n'est appliquée.";
}

export function placeholders(body: string) {
  const names = [...body.matchAll(markerPattern())].map((match) => match[1]).filter((name): name is string => Boolean(name));
  if (body.replace(markerPattern(), "").includes("{{")) return { ok: false as const, message: "Le modèle contient un marqueur invalide." };
  return { ok: true as const, names: [...new Set(names)] };
}

export function renderTemplate(body: string, variables: Record<string, string>) {
  const parsed = placeholders(body);
  if (!parsed.ok) return parsed;
  const missing = parsed.names.filter((name) => !variables[name]?.trim());
  if (missing.length) {
    const management = missing.includes("managementIp");
    return {
      ok: false as const,
      message: management ? "L'équipement n'a pas d'adresse de management." : `Valeur absente : ${missing.join(", ")}`,
    };
  }
  const config = body.replace(markerPattern(), (_match, name: string) => variables[name] ?? "");
  return { ok: true as const, config };
}

export function buildDiff(previous: string, next: string) {
  if (previous === next) return { text: "Aucune différence.", changed: false };
  const removed = previous ? previous.split("\n").map((line) => `- ${line}`) : [];
  const added = next.split("\n").map((line) => `+ ${line}`);
  return { text: [...removed, ...added].join("\n"), changed: true };
}

export function evaluateCritical(templateCritical: boolean, changed: boolean) {
  return templateCritical && changed;
}

export function decideApproval(input: { critical: boolean; authorize: boolean; automaticCritical: boolean }) {
  if (!input.critical) return { ok: true as const, authorization: "WORKFLOW" as const };
  if (input.authorize) return { ok: true as const, authorization: "EXPLICIT" as const };
  if (input.automaticCritical) return { ok: true as const, authorization: "POLICY" as const };
  return { ok: false as const, message: "Une modification critique exige une autorisation explicite ou une politique d'automatisation." };
}

export function deploymentAllowed(critical: boolean, authorization: Authorization) {
  if (!critical) return true;
  return authorization === "EXPLICIT" || authorization === "POLICY";
}

export function dryRunReport(integration: IntegrationId, changed: boolean) {
  const local = changed
    ? "Essai à blanc local. Des différences seraient appliquées. Aucune commande n'est envoyée."
    : "Essai à blanc local. Aucune différence. Aucune commande n'est envoyée.";
  if (integration === "SIMULATION") return local;
  return `${local} ${UNAVAILABLE[integration]}`;
}

export function backupReport(previous: string) {
  const base = previous
    ? "Sauvegarde locale du dernier rendu. Aucune configuration n'a été lue sur l'équipement."
    : "Aucune configuration rendue précédente. Aucune configuration n'a été lue sur l'équipement.";
  return base;
}

export function executionPlan(integration: IntegrationId) {
  if (integration === "SIMULATION") {
    return {
      pushed: false,
      stored: true,
      deviceQueried: false as const,
      report: "Rendu enregistré dans la plateforme. Aucune configuration n'est envoyée à l'équipement.",
    };
  }
  return {
    pushed: false,
    stored: false,
    deviceQueried: false as const,
    report: `${UNAVAILABLE[integration]} Aucune modification n'est appliquée.`,
  };
}

export function verificationPlan(input: { stored: boolean; generated: string | null; integration: IntegrationId }) {
  if (input.stored && input.generated) {
    return {
      verified: true,
      deviceQueried: false as const,
      report: "Le rendu enregistré correspond à la configuration générée. L'équipement n'a pas été relu.",
    };
  }
  const snmp = input.integration === "SNMP" ? " SNMP servirait à relire l'équipement lorsqu'il sera intégré." : "";
  return {
    verified: false,
    deviceQueried: false as const,
    report: `Vérification impossible : aucune modification n'a été envoyée et l'équipement n'a pas été interrogé.${snmp}`,
  };
}
