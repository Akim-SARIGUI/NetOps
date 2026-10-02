<script setup lang="ts">
import type { ChangeOverview, ChangePhase, Device, ListResponse, Organization } from "~/types/api";

definePageMeta({ layout: "console", middleware: "auth" });

const successSteps = [
  { id: "OPEN", label: "Demande" },
  { id: "BACKED_UP", label: "Sauvegarde" },
  { id: "DEPLOYED", label: "Changement" },
  { id: "VERIFIED", label: "Vérification" },
];

const failureSteps = [
  { id: "FAILED", label: "Échec du déploiement" },
  { id: "ROLLED_BACK", label: "Rollback" },
  { id: "ROLLBACK_VERIFIED", label: "Vérification" },
  { id: "INCIDENT", label: "Incident" },
];

const nextAction: Record<ChangePhase, { label: string; path: string } | null> = {
  OPEN: { label: "Sauvegarder", path: "backup" },
  BACKED_UP: { label: "Appliquer le changement", path: "deploy" },
  DEPLOYED: { label: "Vérifier", path: "verify" },
  VERIFIED: null,
  FAILED: { label: "Rollback", path: "rollback" },
  ROLLED_BACK: { label: "Vérifier le rollback", path: "verify-rollback" },
  ROLLBACK_VERIFIED: { label: "Ouvrir l'incident", path: "incident" },
  INCIDENT: null,
};

const session = useSession();
const { data: organizations } = await useFetch<ListResponse<Organization>>("/api/backend/organizations");
const organizationId = ref(organizations.value?.data[0]?.id ?? "");
const canWrite = computed(() => can(session.value, organizationId.value, "inventory:write"));
const { data: changes, refresh } = await useFetch<ChangeOverview>(
  () => (organizationId.value ? `/api/backend/organizations/${organizationId.value}/changes` : null),
  { watch: [organizationId] },
);
const { data: devices } = await useFetch<ListResponse<Device>>(
  () => (organizationId.value ? `/api/backend/organizations/${organizationId.value}/devices` : null),
  { watch: [organizationId] },
);

const message = ref("");
const selectedId = ref("");
const form = reactive({ deviceId: "", title: "", integration: "SIMULATION", proposedContent: "! changement\n" });
const selected = computed(() => {
  const requests = changes.value?.requests ?? [];
  return requests.find((request) => request.id === selectedId.value) ?? requests[0] ?? null;
});
const action = computed(() => (selected.value ? nextAction[selected.value.phase] : null));
const steps = computed(() => (selected.value && ["FAILED", "ROLLED_BACK", "ROLLBACK_VERIFIED", "INCIDENT"].includes(selected.value.phase) ? failureSteps : successSteps));

watch(changes, (value) => {
  if (!selectedId.value && value?.requests[0]) selectedId.value = value.requests[0].id;
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

function createRequest() {
  return run(async () => {
    const created = await $fetch<{ id: string }>(`/api/backend/organizations/${organizationId.value}/changes`, { method: "POST", body: { ...form } });
    selectedId.value = created.id;
    form.title = "";
  });
}

function advance() {
  const request = selected.value;
  const step = action.value;
  if (!request || !step) return;
  return run(() => $fetch(`/api/backend/changes/${request.id}/${step.path}`, { method: "POST" }));
}
</script>

<template>
  <header class="page-head">
    <div>
      <h1>Changements</h1>
      <p class="lede">{{ changes?.notice }}</p>
    </div>
  </header>
  <p v-if="message" class="banner">{{ message }}</p>
  <p>Sauvegarde → Changement → Vérification. En échec : Rollback → Vérification → Incident.</p>

  <section v-if="canWrite" class="panel" style="margin: 16px 0">
    <h2>Nouvelle demande</h2>
    <form class="grid" @submit.prevent="createRequest">
      <label>Équipement
        <select v-model="form.deviceId" required>
          <option value="">Choisir</option>
          <option v-for="device in devices?.data ?? []" :key="device.id" :value="device.id">{{ device.hostname }}</option>
        </select>
      </label>
      <label>Titre <input v-model="form.title" required /></label>
      <label>Intégration
        <select v-model="form.integration">
          <option value="SIMULATION">SIMULATION</option>
          <option value="SSH">SSH</option>
          <option value="ANSIBLE">ANSIBLE</option>
          <option value="VENDOR_API">VENDOR_API</option>
          <option value="SNMP">SNMP</option>
        </select>
      </label>
      <label>Nouvelle configuration <textarea v-model="form.proposedContent" rows="4" required /></label>
      <button type="submit">Créer la demande</button>
    </form>
  </section>

  <section class="panel">
    <h2>Demandes</h2>
    <label v-if="(changes?.requests.length ?? 0) > 1">
      Demande
      <select v-model="selectedId">
        <option v-for="request in changes?.requests ?? []" :key="request.id" :value="request.id">{{ request.title }}</option>
      </select>
    </label>
    <template v-if="selected">
      <p>{{ selected.device.hostname }} · {{ selected.integration }} · {{ selected.important ? 'Changement important' : 'Changement' }}</p>
      <p>
        <template v-for="(step, index) in steps" :key="step.id">
          <strong v-if="selected.phase === step.id">{{ step.label }}</strong>
          <span v-else>{{ step.label }}</span>
          <span v-if="index < steps.length - 1"> → </span>
        </template>
      </p>
      <p v-if="selected.backup">{{ selected.backup.notice }}</p>
      <pre v-if="selected.diffText">{{ selected.diffText }}</pre>
      <p v-if="selected.incident">{{ selected.incident.summary }}</p>
      <h3>Versions</h3>
      <ul v-if="selected.versions.length">
        <li v-for="version in selected.versions" :key="version.id">v{{ version.number }} · {{ version.origin }}</li>
      </ul>
      <p v-else class="empty">Aucune version.</p>
      <h3>Journal</h3>
      <table v-if="selected.logs.length">
        <thead>
          <tr>
            <th>Utilisateur</th>
            <th>Date</th>
            <th>Équipement</th>
            <th>Ancienne configuration</th>
            <th>Nouvelle configuration</th>
            <th>Résultat</th>
            <th>Source</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="entry in selected.logs" :key="entry.id">
            <td>{{ entry.actor.name }}</td>
            <td>{{ entry.occurredAt }}</td>
            <td>{{ entry.device.hostname }}</td>
            <td><pre>{{ entry.oldConfig || '—' }}</pre></td>
            <td><pre>{{ entry.newConfig || '—' }}</pre></td>
            <td>{{ entry.result }}</td>
            <td>{{ entry.sourceAddress }}</td>
          </tr>
        </tbody>
      </table>
      <button v-if="canWrite && action" type="button" @click="advance">{{ action.label }}</button>
    </template>
    <AppEmpty v-else title="Aucune demande." description="Sélectionnez une demande ou créez-en une nouvelle." />
  </section>
</template>
