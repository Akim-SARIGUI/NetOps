<script setup lang="ts">
import type { DiscoveryOverview, ListResponse, Organization, Site } from "~/types/api";

definePageMeta({ layout: "console", middleware: "auth" });

const steps = [
  { id: "DISCOVERY", label: "Découverte" },
  { id: "REVIEW", label: "Revue" },
  { id: "APPROVED", label: "Approbation" },
  { id: "IMPORTED", label: "Import" },
];

const verdictLabel: Record<string, string> = {
  DISCOVERED: "Découvert",
  UNKNOWN: "Inconnu",
  MATCHED: "Correspondant",
  CONFLICT: "Conflit",
};

const session = useSession();
const { data: organizations } = await useFetch<ListResponse<Organization>>("/api/backend/organizations");
const organizationId = ref(organizations.value?.data[0]?.id ?? "");
const canWrite = computed(() => can(session.value, organizationId.value, "inventory:write"));
const { data: sites } = await useFetch<ListResponse<Site>>(
  () => (organizationId.value ? `/api/backend/organizations/${organizationId.value}/sites` : null),
  { watch: [organizationId] },
);
const { data: discovery, refresh } = await useFetch<DiscoveryOverview>(
  () => (organizationId.value ? `/api/backend/organizations/${organizationId.value}/discovery` : null),
  { watch: [organizationId] },
);

const message = ref("");
const selected = ref<string[]>(["SIMULATION"]);
const selectedRunId = ref("");
const decisions = reactive<Record<string, string>>({});
const importSiteId = ref("");
const confirmProduction = ref(false);

const selectedRun = computed(() => {
  const runs = discovery.value?.runs ?? [];
  return runs.find((run) => run.id === selectedRunId.value) ?? runs[0] ?? null;
});
const importSite = computed(() => (sites.value?.data ?? []).find((site) => site.id === importSiteId.value) ?? null);

watch(discovery, (value) => {
  if (!selectedRunId.value && value?.runs[0]) selectedRunId.value = value.runs[0].id;
}, { immediate: true });

watch(sites, (value) => {
  if (!importSiteId.value) importSiteId.value = value?.data.find((site) => site.environment === "LAB")?.id ?? value?.data[0]?.id ?? "";
}, { immediate: true });

function joinList(values: string[]) {
  return values.length ? values.join(", ") : "—";
}

async function run(action: () => Promise<void>) {
  message.value = "";
  try {
    await action();
    await refresh();
  } catch (error) {
    message.value = apiErrorMessage(error);
  }
}

function createRun() {
  return run(async () => {
    const created = await $fetch<{ id: string }>(`/api/backend/organizations/${organizationId.value}/discovery/runs`, {
      method: "POST",
      body: { connectors: selected.value },
    });
    selectedRunId.value = created.id;
  });
}

function reviewRun() {
  const current = selectedRun.value;
  if (!current) return;
  return run(async () => {
    await $fetch(`/api/backend/discovery/runs/${current.id}/review`, { method: "POST" });
  });
}

function onDecision(event: Event, findingId: string) {
  decisions[findingId] = (event.target as HTMLSelectElement).value;
}

function approveRun() {
  const current = selectedRun.value;
  if (!current) return;
  return run(async () => {
    await $fetch(`/api/backend/discovery/runs/${current.id}/approve`, {
      method: "POST",
      body: {
        decisions: current.findings.map((finding) => ({ findingId: finding.id, decision: decisions[finding.id] })),
      },
    });
  });
}

function importRun() {
  const current = selectedRun.value;
  if (!current || !importSiteId.value) return;
  return run(async () => {
    await $fetch(`/api/backend/discovery/runs/${current.id}/import`, {
      method: "POST",
      body: { siteId: importSiteId.value, confirmProduction: confirmProduction.value },
    });
  });
}
</script>

<template>
  <header class="page-head">
    <div>
      <h1>Découverte</h1>
      <p class="lede">{{ discovery?.notice }}</p>
    </div>
  </header>
  <p v-if="message" class="banner">{{ message }}</p>
  <p class="hint">{{ discovery?.connectorNotice }}</p>

  <section class="panel" style="margin-bottom: 16px">
    <h2>Connecteurs</h2>
    <ul v-if="discovery?.connectors.length">
      <li v-for="connector in discovery.connectors" :key="connector.connector">
        <span class="mono">{{ connector.connector }}</span> · {{ connector.available ? 'Disponible' : connector.message }}
      </li>
    </ul>
  </section>

  <section v-if="canWrite" class="panel" style="margin-bottom: 16px">
    <h2>Lancer la découverte</h2>
    <form class="grid" @submit.prevent="createRun">
      <fieldset>
        <legend>Connecteurs</legend>
        <label v-for="connector in discovery?.connectors ?? []" :key="connector.connector">
          <input v-model="selected" type="checkbox" :value="connector.connector" /> {{ connector.connector }}
        </label>
      </fieldset>
      <button type="submit">Lancer</button>
    </form>
  </section>

  <section class="panel">
    <h2>Dossiers</h2>
    <label v-if="(discovery?.runs.length ?? 0) > 1">
      Dossier
      <select v-model="selectedRunId">
        <option v-for="run in discovery?.runs ?? []" :key="run.id" :value="run.id">{{ run.label }}</option>
      </select>
    </label>
    <template v-if="selectedRun">
      <p>{{ selectedRun.notice }}</p>
      <p>
        <template v-for="(step, index) in steps" :key="step.id">
          <strong v-if="selectedRun.status === step.id">{{ step.label }}</strong>
          <span v-else>{{ step.label }}</span>
          <span v-if="index < steps.length - 1"> → </span>
        </template>
      </p>
      <table v-if="selectedRun.findings.length">
        <thead>
          <tr>
            <th>Résultat</th>
            <th>Équipement</th>
            <th>IP</th>
            <th>MAC</th>
            <th>Nom</th>
            <th>Interfaces</th>
            <th>Ports</th>
            <th>VLAN</th>
            <th>Voisins</th>
            <th>Décision</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="finding in selectedRun.findings" :key="finding.id">
            <td><span class="mono">{{ finding.verdict }}</span> · {{ verdictLabel[finding.verdict] }}</td>
            <td>{{ finding.role ?? '—' }}</td>
            <td>{{ finding.ipAddress ?? '—' }}</td>
            <td>{{ finding.macAddress ?? '—' }}</td>
            <td>
              {{ finding.hostname ?? '—' }}
              <p v-if="finding.conflictReason" class="hint">{{ finding.conflictReason }}</p>
              <p v-if="finding.matchedDevice" class="hint">Inventaire : {{ finding.matchedDevice.hostname }}</p>
              <p v-if="finding.importedDevice" class="hint">Importé : {{ finding.importedDevice.hostname }} · {{ finding.importedDevice.status }}</p>
            </td>
            <td>{{ joinList(finding.interfaces.map((item) => item.name + ' ' + item.status)) }}</td>
            <td>{{ joinList(finding.ports.map((item) => item.name + (item.vlan ? ' VLAN ' + item.vlan : ''))) }}</td>
            <td>{{ joinList(finding.vlans.map((item) => String(item.vid) + (item.name ? ' ' + item.name : ''))) }}</td>
            <td>{{ joinList(finding.neighbors.map((item) => item.hostname + ' ' + item.localPort)) }}</td>
            <td>
              <select v-if="canWrite && selectedRun.status === 'REVIEW'" :value="decisions[finding.id] ?? ''" @change="onDecision($event, finding.id)">
                <option value="">Choisir</option>
                <option value="ACCEPTED">Accepter</option>
                <option value="REJECTED">Refuser</option>
              </select>
              <span v-else>{{ finding.decision === 'PENDING' ? 'En attente' : finding.decision === 'ACCEPTED' ? 'Acceptée' : 'Refusée' }}</span>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else class="empty">Aucune observation. Les connecteurs réels n'ont rien lu.</p>
      <button v-if="canWrite && selectedRun.status === 'DISCOVERY'" type="button" @click="reviewRun">Passer en revue</button>
      <button v-if="canWrite && selectedRun.status === 'REVIEW'" type="button" @click="approveRun">Approuver</button>
      <form v-if="canWrite && selectedRun.status === 'APPROVED'" class="grid" @submit.prevent="importRun">
        <label>Site d'import
          <select v-model="importSiteId" required>
            <option v-for="site in sites?.data ?? []" :key="site.id" :value="site.id">{{ site.name }} · {{ site.environment }}</option>
          </select>
        </label>
        <label v-if="importSite?.environment === 'PRODUCTION'">
          <input v-model="confirmProduction" type="checkbox" /> Confirmer l'import sur un site de production
        </label>
        <button type="submit">Importer les observations acceptées</button>
        <p class="hint">Seul un équipement au statut prévu est créé. Les interfaces, ports, VLAN et voisins restent dans le dossier.</p>
      </form>
    </template>
    <p v-else class="empty">Aucune découverte.</p>
  </section>
</template>
