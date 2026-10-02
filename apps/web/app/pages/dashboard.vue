<script setup lang="ts">
import type { ChangeOverview, Device, ListResponse, MonitoringDashboard, Organization, Vlan } from "~/types/api";

definePageMeta({ layout: "console", middleware: "auth" });

const session = useSession();
const { data: organizations } = await useFetch<ListResponse<Organization>>("/api/backend/organizations");
const organizationId = computed(() => organizations.value?.data[0]?.id ?? "");

const { data: devices, pending: devicesPending } = await useFetch<ListResponse<Device>>(
  () => (organizationId.value ? `/api/backend/organizations/${organizationId.value}/devices` : null),
  { watch: [organizationId] },
);
const { data: vlans, pending: vlansPending } = await useFetch<ListResponse<Vlan>>(
  () => (organizationId.value ? `/api/backend/organizations/${organizationId.value}/vlans` : null),
  { watch: [organizationId] },
);
const { data: monitoring, pending: monitoringPending } = await useFetch<MonitoringDashboard>(
  () => (organizationId.value ? `/api/backend/organizations/${organizationId.value}/monitoring` : null),
  { watch: [organizationId] },
);
const { data: changes } = await useFetch<ChangeOverview>(
  () => (organizationId.value ? `/api/backend/organizations/${organizationId.value}/changes` : null),
  { watch: [organizationId] },
);

const loading = computed(() => devicesPending.value || vlansPending.value || monitoringPending.value);
const deviceCount = computed(() => devices.value?.data.length ?? 0);
const vlanCount = computed(() => vlans.value?.data.length ?? 0);
const alertCount = computed(() => monitoring.value?.alerts.length ?? 0);
const onlineCount = computed(() => monitoring.value?.totals.online ?? null);
const offlineCount = computed(() => monitoring.value?.totals.offline ?? null);
const recentAlerts = computed(() => (monitoring.value?.alerts ?? []).slice(0, 6));
const recentChanges = computed(() => (changes.value?.requests ?? []).slice(0, 6));
</script>

<template>
  <header class="page-head">
    <div>
      <h1>Dashboard</h1>
      <p class="lede">Bonjour, {{ session?.user.name }}. Vue d'ensemble de l'infrastructure enregistrée.</p>
    </div>
  </header>

  <div v-if="loading" class="stats-grid">
    <AppCard v-for="index in 4" :key="index"><AppSkeleton height="64px" /></AppCard>
  </div>
  <div v-else class="stats-grid">
    <AppCard label="Équipements" :value="deviceCount" footnote="Inventaire organisation" />
    <AppCard label="VLAN" :value="vlanCount" footnote="Commutation enregistrée" />
    <AppCard label="Alertes" :value="alertCount" footnote="Supervision" />
    <AppCard
      label="Disponibilité"
      :value="onlineCount === null ? '—' : `${onlineCount} online`"
      :footnote="offlineCount === null ? 'Aucune cible supervisée' : `${offlineCount} offline`"
    />
  </div>

  <div class="grid">
    <section class="panel">
      <h2>Alertes récentes</h2>
      <p v-if="monitoring?.notice" class="hint">{{ monitoring.notice }}</p>
      <table v-if="recentAlerts.length">
        <thead>
          <tr>
            <th>Code</th>
            <th>Équipement</th>
            <th>Message</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(alert, index) in recentAlerts" :key="`${alert.code}-${index}`">
            <td><AppBadge tone="danger" :label="alert.code" /></td>
            <td class="mono">{{ alert.device ?? '—' }}</td>
            <td>{{ alert.message }}</td>
          </tr>
        </tbody>
      </table>
      <AppEmpty
        v-else
        title="Aucune alerte"
        description="La supervision n'a signalé aucun incident sur les cibles enregistrées."
        action-label="Ouvrir la supervision"
        @action="navigateTo('/monitoring')"
      />
    </section>

    <section class="panel">
      <h2>Changements récents</h2>
      <ul v-if="recentChanges.length" class="stack" style="gap: 10px; margin: 0; padding: 0; list-style: none">
        <li v-for="request in recentChanges" :key="request.id">
          <strong>{{ request.title }}</strong>
          <div class="hint">{{ request.device.hostname }} · {{ request.phase }}</div>
        </li>
      </ul>
      <AppEmpty
        v-else
        title="Aucun changement"
        description="Aucune demande de changement n'est enregistrée pour l'instant."
        action-label="Ouvrir les changements"
        @action="navigateTo('/changes')"
      />
    </section>
  </div>
</template>
