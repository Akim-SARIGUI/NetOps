<script setup lang="ts">
import type { AutomationOverview, AutomationStage, Device, ListResponse, Organization } from "~/types/api";

definePageMeta({ layout: "console", middleware: "auth" });

const steps = [
  { id: "DESIRED", label: "État souhaité" },
  { id: "VALIDATION", label: "Validation" },
  { id: "GENERATE", label: "Génération" },
  { id: "DIFF", label: "Diff" },
  { id: "DRY_RUN", label: "Essai à blanc" },
  { id: "APPROVAL", label: "Approbation" },
  { id: "BACKUP", label: "Sauvegarde" },
  { id: "DEPLOYMENT", label: "Déploiement" },
  { id: "VERIFICATION", label: "Vérification" },
];

const nextAction: Record<AutomationStage, { label: string; path: string } | null> = {
  DESIRED: { label: "Valider", path: "validate" },
  VALIDATION: { label: "Générer", path: "generate" },
  GENERATE: { label: "Calculer le diff", path: "diff" },
  DIFF: { label: "Essai à blanc", path: "dry-run" },
  DRY_RUN: { label: "Approuver", path: "approve" },
  APPROVAL: { label: "Sauvegarder", path: "backup" },
  BACKUP: { label: "Déployer", path: "deploy" },
  DEPLOYMENT: { label: "Vérifier", path: "verify" },
  VERIFICATION: null,
};

const session = useSession();
const { data: organizations } = await useFetch<ListResponse<Organization>>("/api/backend/organizations");
const organizationId = ref(organizations.value?.data[0]?.id ?? "");
const canWrite = computed(() => can(session.value, organizationId.value, "inventory:write"));
const { data: automation, refresh } = await useFetch<AutomationOverview>(
  () => (organizationId.value ? `/api/backend/organizations/${organizationId.value}/automation` : null),
  { watch: [organizationId] },
);
const { data: devices } = await useFetch<ListResponse<Device>>(
  () => (organizationId.value ? `/api/backend/organizations/${organizationId.value}/devices` : null),
  { watch: [organizationId] },
);

const message = ref("");
const selectedJobId = ref("");
const automaticCritical = ref(false);
const authorize = ref(false);
const templateForm = reactive({ name: "", kind: "BANNER", body: "banner motd ^\n{{hostname}}\n^" });
const jobForm = reactive({ deviceId: "", templateId: "", integration: "SIMULATION" });

const selectedJob = computed(() => {
  const jobs = automation.value?.jobs ?? [];
  return jobs.find((job) => job.id === selectedJobId.value) ?? jobs[0] ?? null;
});
const action = computed(() => (selectedJob.value ? nextAction[selectedJob.value.stage] : null));

watch(automation, (value) => {
  automaticCritical.value = value?.policy.automaticCritical ?? false;
  if (!selectedJobId.value && value?.jobs[0]) selectedJobId.value = value.jobs[0].id;
}, { immediate: true });

async function run(task: () => Promise<void>) {
  message.value = "";
  try {
    await task();
    await refresh();
  } catch (error) {
    message.value = apiErrorMessage(error);
  }
}

function savePolicy() {
  return run(() => $fetch(`/api/backend/organizations/${organizationId.value}/automation/policy`, {
    method: "PUT",
    body: { automaticCritical: automaticCritical.value },
  }));
}

function createTemplate() {
  return run(async () => {
    await $fetch(`/api/backend/organizations/${organizationId.value}/automation/templates`, { method: "POST", body: { ...templateForm } });
    templateForm.name = "";
  });
}

function createJob() {
  return run(async () => {
    const created = await $fetch<{ id: string }>(`/api/backend/organizations/${organizationId.value}/automation/jobs`, {
      method: "POST",
      body: { ...jobForm },
    });
    selectedJobId.value = created.id;
  });
}

function advance() {
  const job = selectedJob.value;
  const step = action.value;
  if (!job || !step) return;
  return run(() => $fetch(`/api/backend/automation/jobs/${job.id}/${step.path}`, {
    method: "POST",
    body: step.path === "approve" ? { authorize: authorize.value } : {},
  }));
}
</script>

<template>
  <header class="page-head">
    <div>
      <h1>Automatisation</h1>
      <p class="lede">{{ automation?.notice }}</p>
    </div>
  </header>
  <p v-if="message" class="banner">{{ message }}</p>
  <p class="hint">{{ automation?.integrationNotice }}</p>
  <p>{{ automation?.policy.automaticCritical ? "Politique d'automatisation active pour les modifications critiques." : "Les modifications critiques exigent une autorisation explicite." }}</p>

  <section class="panel" style="margin-bottom: 16px">
    <h2>Intégrations</h2>
    <ul v-if="automation?.integrations.length">
      <li v-for="integration in automation.integrations" :key="integration.id">
        <span class="mono">{{ integration.id }}</span> · {{ integration.available ? 'Disponible en simulation' : integration.message }}
      </li>
    </ul>
  </section>

  <section v-if="canWrite" class="panel" style="margin-bottom: 16px">
    <h2>Politique</h2>
    <form class="grid" @submit.prevent="savePolicy">
      <label>
        <input v-model="automaticCritical" type="checkbox" /> Autoriser les modifications critiques sans case d'autorisation
      </label>
      <button type="submit">Enregistrer la politique</button>
    </form>
  </section>

  <section class="panel" style="margin-bottom: 16px">
    <h2>Modèles</h2>
    <ul v-if="automation?.templates.length">
      <li v-for="template in automation.templates" :key="template.id">
        {{ template.name }} · {{ template.kind }} · {{ template.critical ? 'Critique' : 'Informatif' }}
      </li>
    </ul>
    <form v-if="canWrite" class="grid" @submit.prevent="createTemplate">
      <h3>Nouveau modèle</h3>
      <label>Nom <input v-model="templateForm.name" required /></label>
      <label>Type
        <select v-model="templateForm.kind">
          <option value="BANNER">Bannière</option>
          <option value="INTERFACE">Interface</option>
          <option value="VLAN">VLAN</option>
          <option value="ROUTING">Routage</option>
          <option value="FIREWALL">Pare-feu</option>
        </select>
      </label>
      <label>Corps <textarea v-model="templateForm.body" rows="4" required /></label>
      <button type="submit">Créer le modèle</button>
    </form>
  </section>

  <section v-if="canWrite" class="panel" style="margin-bottom: 16px">
    <h2>Nouveau travail</h2>
    <form class="grid" @submit.prevent="createJob">
      <label>Équipement
        <select v-model="jobForm.deviceId" required>
          <option value="">Choisir</option>
          <option v-for="device in devices?.data ?? []" :key="device.id" :value="device.id">{{ device.hostname }}</option>
        </select>
      </label>
      <label>Modèle
        <select v-model="jobForm.templateId" required>
          <option value="">Choisir</option>
          <option v-for="template in automation?.templates ?? []" :key="template.id" :value="template.id">{{ template.name }}</option>
        </select>
      </label>
      <label>Intégration
        <select v-model="jobForm.integration">
          <option v-for="integration in automation?.integrations ?? []" :key="integration.id" :value="integration.id">{{ integration.id }}</option>
        </select>
      </label>
      <button type="submit">Créer le travail</button>
    </form>
  </section>

  <section class="panel">
    <h2>Travaux</h2>
    <label v-if="(automation?.jobs.length ?? 0) > 1">
      Travail
      <select v-model="selectedJobId">
        <option v-for="job in automation?.jobs ?? []" :key="job.id" :value="job.id">{{ job.label }}</option>
      </select>
    </label>
    <template v-if="selectedJob">
      <p>{{ selectedJob.device.hostname }} · {{ selectedJob.template.name }} · {{ selectedJob.integration }}</p>
      <p>
        <template v-for="(step, index) in steps" :key="step.id">
          <strong v-if="selectedJob.stage === step.id">{{ step.label }}</strong>
          <span v-else>{{ step.label }}</span>
          <span v-if="index < steps.length - 1"> → </span>
        </template>
      </p>
      <p v-if="selectedJob.critical">Modification critique.</p>
      <pre v-if="selectedJob.generatedConfig">{{ selectedJob.generatedConfig }}</pre>
      <pre v-if="selectedJob.diffText">{{ selectedJob.diffText }}</pre>
      <p v-if="selectedJob.dryRunReport">{{ selectedJob.dryRunReport }}</p>
      <p v-if="selectedJob.backupReport">{{ selectedJob.backupReport }}</p>
      <p v-if="selectedJob.executionReport">{{ selectedJob.executionReport }}</p>
      <p v-if="selectedJob.verificationReport">{{ selectedJob.verificationReport }}</p>
      <form v-if="canWrite && action" class="grid" @submit.prevent="advance">
        <label v-if="action.path === 'approve' && selectedJob.critical">
          <input v-model="authorize" type="checkbox" /> Autoriser cette modification critique
        </label>
        <button type="submit">{{ action.label }}</button>
      </form>
    </template>
    <p v-else class="empty">Aucun travail.</p>
  </section>
</template>
