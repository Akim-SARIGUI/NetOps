export const LAB_NOTICE =
  "Mode LAB isolé. Aucune configuration n'est lue ni envoyée sur un équipement de production.";
export const PROMOTION_NOTICE =
  "Promotion locale. La configuration n'est pas appliquée sur l'environnement cible.";

export const ENVIRONMENTS = ["LAB", "DEV", "STAGING", "PRODUCTION"] as const;
export const LAB_ROLES = ["ROUTER", "SWITCH", "FIREWALL", "SERVER", "CLIENT"] as const;
export const SCENARIO_KINDS = ["VLAN", "DHCP", "DNS", "ROUTING", "ACL", "CONNECTIVITY"] as const;
export const PROMOTION_PHASES = ["PREPARED", "VALIDATED", "PROMOTED"] as const;

export type EnvironmentId = (typeof ENVIRONMENTS)[number];
export type LabRoleId = (typeof LAB_ROLES)[number];
export type ScenarioKind = (typeof SCENARIO_KINDS)[number];
export type PromotionPhase = (typeof PROMOTION_PHASES)[number];

export type LabNodePlan = { role: LabRoleId; hostname: string; address: string };
export type ScenarioPlan = { kind: ScenarioKind; label: string; ready: boolean; plan: string; observation: string };

export type PromotionStep = { from: EnvironmentId; to: EnvironmentId };

export const PROMOTION_PATH: readonly PromotionStep[] = [
  { from: "LAB", to: "STAGING" },
  { from: "STAGING", to: "PRODUCTION" },
] as const;

const NODE_PLANS: LabNodePlan[] = [
  { role: "ROUTER", hostname: "lab-router", address: "10.255.0.1" },
  { role: "SWITCH", hostname: "lab-switch", address: "10.255.0.2" },
  { role: "FIREWALL", hostname: "lab-firewall", address: "10.255.0.3" },
  { role: "SERVER", hostname: "lab-server", address: "10.255.0.10" },
  { role: "CLIENT", hostname: "lab-client", address: "10.255.0.25" },
];

const SCENARIO_LABELS: Record<ScenarioKind, string> = {
  VLAN: "VLAN",
  DHCP: "DHCP",
  DNS: "DNS",
  ROUTING: "Routing",
  ACL: "ACL",
  CONNECTIVITY: "Connectivity",
};

export function nodeCatalog(): LabNodePlan[] {
  return NODE_PLANS.map((node) => ({ ...node }));
}

export function scenarioCatalog(): ScenarioPlan[] {
  return SCENARIO_KINDS.map((kind) => buildScenario(kind));
}

export function buildScenario(kind: ScenarioKind): ScenarioPlan {
  const observation = "Scénario local au LAB. Aucun équipement de production n'est modifié. Ce n'est pas une mesure.";
  if (kind === "VLAN") {
    return {
      kind,
      label: SCENARIO_LABELS.VLAN,
      ready: true,
      plan: "VLAN 100 LAB-DATA prévu sur lab-switch, isolé du site de production.",
      observation,
    };
  }
  if (kind === "DHCP") {
    return {
      kind,
      label: SCENARIO_LABELS.DHCP,
      ready: true,
      plan: "Scope 10.255.0.100-10.255.0.200 prévu sur lab-server pour le VLAN 100.",
      observation,
    };
  }
  if (kind === "DNS") {
    return {
      kind,
      label: SCENARIO_LABELS.DNS,
      ready: true,
      plan: "Zone lab.local prévue sur lab-server, avec lab-client.lab.local → 10.255.0.25.",
      observation,
    };
  }
  if (kind === "ROUTING") {
    return {
      kind,
      label: SCENARIO_LABELS.ROUTING,
      ready: true,
      plan: "Route par défaut prévue sur lab-router via lab-firewall (10.255.0.3).",
      observation,
    };
  }
  if (kind === "ACL") {
    return {
      kind,
      label: SCENARIO_LABELS.ACL,
      ready: true,
      plan: "Politique prévue : client du VLAN 100 autorisé vers lab-server:80, le reste refusé.",
      observation,
    };
  }
  return {
    kind,
    label: SCENARIO_LABELS.CONNECTIVITY,
    ready: true,
    plan: "Chemin prévu : lab-client → lab-switch → lab-router → lab-firewall → lab-server.",
    observation,
  };
}

export function renderConfiguration(nodes: readonly LabNodePlan[], scenarios: readonly ScenarioPlan[]) {
  const nodeLines = nodes.map((node) => `${node.role} ${node.hostname} ${node.address}`);
  const scenarioLines = scenarios.map((item) => `${item.kind}: ${item.plan}`);
  return ["# configuration LAB isolée", ...nodeLines, "", "# scénarios", ...scenarioLines].join("\n");
}

export function promotionAllowed(source: EnvironmentId, target: EnvironmentId) {
  return PROMOTION_PATH.some((step) => step.from === source && step.to === target);
}

export function fabricEnvironmentError(environment: EnvironmentId) {
  if (environment !== "LAB") {
    return "Une fabrique LAB ne peut être créée que sur un site d'environnement LAB.";
  }
  return null;
}

export function preparePromotionError(input: {
  fabricEnvironment: EnvironmentId;
  targetEnvironment: EnvironmentId;
  sourcePromotion: { phase: PromotionPhase; targetEnvironment: EnvironmentId } | null;
  scenariosReady: boolean;
}) {
  if (!input.scenariosReady) return "Tous les scénarios doivent être prêts avant une promotion.";
  if (!input.sourcePromotion) {
    if (input.fabricEnvironment !== "LAB") return "La première promotion part du LAB.";
    if (input.targetEnvironment !== "STAGING") return "Depuis le LAB, la cible doit être STAGING.";
    return null;
  }
  if (input.sourcePromotion.phase !== "PROMOTED") {
    return "La promotion précédente doit être validée puis promue avant l'étape suivante.";
  }
  if (input.sourcePromotion.targetEnvironment !== "STAGING") {
    return "La promotion précédente doit viser STAGING.";
  }
  if (input.targetEnvironment !== "PRODUCTION") return "Après STAGING, la cible doit être PRODUCTION.";
  return null;
}

export function validatePromotionError(phase: PromotionPhase) {
  if (phase !== "PREPARED") return "Seule une promotion préparée peut être validée.";
  return null;
}

export function promoteError(input: {
  phase: PromotionPhase;
  targetEnvironment: EnvironmentId;
  confirmProduction: boolean;
}) {
  if (input.phase !== "VALIDATED") return "La promotion exige une validation entre les environnements.";
  if (input.targetEnvironment === "PRODUCTION" && !input.confirmProduction) {
    return "La promotion vers PRODUCTION exige une confirmation explicite.";
  }
  return null;
}

export function environmentsCatalog() {
  return ENVIRONMENTS.map((id) => ({
    id,
    label: id,
    promotableFrom: PROMOTION_PATH.filter((step) => step.to === id).map((step) => step.from),
    promotableTo: PROMOTION_PATH.filter((step) => step.from === id).map((step) => step.to),
  }));
}
