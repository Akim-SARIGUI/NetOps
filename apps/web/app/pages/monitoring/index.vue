<script setup lang="ts">
import type { Device, ListResponse, MonitoringDashboard, Organization, Site } from "~/types/api";

definePageMeta({ layout: "console", middleware: "auth" });

const session = useSession();
const { data: organizations } = await useFetch<ListResponse<Organization>>("/api/backend/organizations");
const organizationId = ref(organizations.value?.data[0]?.id ?? "");
const siteId = ref("");
const canWrite = computed(() => can(session.value, organizationId.value, "inventory:write"));
const query = computed(() => (siteId.value ? { siteId: siteId.value } : {}));
const { data: sites } = await useFetch<ListResponse<Site>>(
  () => (organizationId.value ? `/api/backend/organizations/${organizationId.value}/sites` : null),
  { watch: [organizationId] },
);
const { data: monitoring, refresh } = await useFetch<MonitoringDashboard>(
  () => (organizationId.value ? `/api/backend/organizations/${organizationId.value}/monitoring` : null),
  { query, watch: [organizationId, query] },
);
const { data: devices } = await useFetch<ListResponse<Device>>(
  () => (organizationId.value ? `/api/backend/organizations/${organizationId.value}/devices` : null),
  { watch: [organizationId] },
);

const message = ref("");
const form = reactive({ deviceId: "", mode: "SIMULATION" });
const availableDevices = computed(() => {
  const monitored = new Set((monitoring.value?.targets ?? []).map((target) => target.device.id));
  return (devices.value?.data ?? []).filter((device) => !monitored.has(device.id));
});

watch(organizationId, () => {
  siteId.value = "";
});

function trafficLabel(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  if (value >= 1_000_000_000) return `${Math.round(value / 1_000_000_0) / 100} Gbit/s`;
  if (value >= 1_000_000) return `${Math.round(value / 10_000) / 100} Mbit/s`;
  return `${value} bit/s`;
}

function uptimeLabel(value: number | null) {
  if (value === null) return "—";
  const days = Math.floor(value / 86400);
  return days > 0 ? `${days} j` : `${Math.floor(value / 3600)} h`;
}

function percent(value: number | null | undefined) {
  return value === null || value === undefined ? "—" : `${value} %`;
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

function createTarget() {
  return run(async () => {
    await $fetch(`/api/backend/organizations/${organizationId.value}/monitoring/targets`, {
      method: "POST",
      body: { deviceId: form.deviceId, mode: form.mode },
    });
    form.deviceId = "";
  });
}

function setMode(targetId: string, mode: string) {
  return run(() => $fetch(`/api/backend/monitoring/targets/${targetId}`, { method: "PATCH", body: { mode } }));
}

function onMode(event: Event, targetId: string) {
  const value = (event.target as HTMLSelectElement).value;
  return setMode(targetId, value);
}
</script>

<template>
  <header class="page-head">
    <div>
      <h1>Supervision</h1>
      <p class="lede">{{ monitoring?.notice }}</p>
    </div>
    <label>
      Site
      <select v-model="siteId">
        <option value="">Tous</option>
        <option v-for="site in sites?.data ?? []" :key="site.id" :value="site.id">{{ site.name }}</option>
      </select>
    </label>
  </header>
  <p v-if="message" class="banner">{{ message }}</p>
  <div class="metrics">
    <article class="metric"><span>Équipements</span><strong>{{ monitoring?.totals.devices ?? 0 }}</strong></article>
    <article class="metric"><span>En ligne</span><strong>{{ monitoring?.totals.online ?? 0 }}</strong></article>
    <article class="metric"><span>Hors ligne</span><strong>{{ monitoring?.totals.offline ?? 0 }}</strong></article>
    <article class="metric"><span>Critiques</span><strong>{{ monitoring?.totals.critical ?? 0 }}</strong></article>
  </div>
  <div class="metrics">
    <article class="metric"><span>Trafic</span><strong>{{ trafficLabel(monitoring?.totals.trafficBps) }}</strong></article>
    <article class="metric"><span>Latence</span><strong>{{ monitoring?.totals.latencyMs ?? 0 }} ms</strong></article>
    <article class="metric"><span>Perte de paquets</span><strong>{{ monitoring?.totals.packetLossPercent ?? 0 }} %</strong></article>
  </div>
  <div class="metrics">
    <article class="metric"><span>Utilisation VLAN</span><strong>{{ monitoring?.totals.vlanUtilization ?? 0 }} %</strong></article>
    <article class="metric"><span>Utilisation IP</span><strong>{{ monitoring?.totals.ipUtilization ?? 0 }} %</strong></article>
    <article class="metric"><span>Utilisation DHCP</span><strong>{{ monitoring?.totals.dhcpUtilization ?? 0 }} %</strong></article>
  </div>

  <section class="panel" style="margin-bottom: 16px">
    <h2>Alertes</h2>
    <ul v-if="monitoring?.alerts.length" style="list-style: none; padding: 0; margin: 0; display: grid; gap: 8px">
      <li v-for="alert in monitoring.alerts" :key="alert.code + alert.message">
        <AppBadge tone="danger" :label="alert.code" />
        <span style="margin-left: 8px">{{ alert.message }}</span>
      </li>
    </ul>
    <AppEmpty v-else title="Aucune alerte." description="Aucun incident signalé sur les cibles supervisées." />
  </section>

  <section class="panel" style="margin-bottom: 16px">
    <h2>Cibles</h2>
    <table v-if="monitoring?.targets.length">
      <thead>
        <tr>
          <th>Équipement</th>
          <th>État</th>
          <th>CPU</th>
          <th>RAM</th>
          <th>Latence</th>
          <th>Perte</th>
          <th>Uptime</th>
          <th>Erreurs</th>
          <th>Interfaces</th>
          <th>Collecteur</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="target in monitoring.targets" :key="target.id">
          <td>{{ target.device.hostname }}</td>
          <td>
            <AppBadge
              :tone="target.status === 'ONLINE' ? 'success' : target.status === 'OFFLINE' ? 'danger' : 'warning'"
              :label="target.status === 'ONLINE' ? 'En ligne' : target.status === 'OFFLINE' ? 'Hors ligne' : target.status === 'UNKNOWN' ? 'Inconnu' : 'Désactivé'"
            />
          </td>
          <td>{{ percent(target.metrics.cpu) }}</td>
          <td>{{ percent(target.metrics.ram) }}</td>
          <td>{{ target.metrics.latencyMs === null ? '—' : target.metrics.latencyMs + ' ms' }}</td>
          <td>{{ percent(target.metrics.packetLossPercent) }}</td>
          <td>{{ uptimeLabel(target.metrics.uptimeSeconds) }}</td>
          <td>{{ target.metrics.errors ?? '—' }}</td>
          <td>
            <span v-for="iface in target.metrics.interfaces" :key="iface.name">{{ iface.name }} {{ iface.status }} · {{ trafficLabel(iface.trafficBps) }}<br /></span>
          </td>
          <td>
            <select v-if="canWrite" :value="target.mode" @change="onMode($event, target.id)">
              <option value="SIMULATION">Simulation</option>
              <option value="ICMP">ICMP</option>
              <option value="SNMP">SNMP</option>
            </select>
            <span v-else>{{ target.simulated ? 'Simulation' : target.mode }}</span>
            <p v-if="target.collectorMessage" class="hint">{{ target.collectorMessage }}</p>
          </td>
        </tr>
      </tbody>
    </table>
    <AppEmpty v-else title="Aucune cible." description="Ajoutez une cible pour suivre l'état des équipements." />
    <p class="hint">{{ monitoring?.collectorNotice }}</p>
  </section>

  <section class="panel">
    <h2>VLAN</h2>
    <ul v-if="monitoring?.vlans.length">
      <li v-for="vlan in monitoring.vlans" :key="vlan.id">VLAN {{ vlan.vid }} {{ vlan.name }} · {{ vlan.utilization }} %</li>
    </ul>
    <AppEmpty v-else title="Aucune utilisation de VLAN." description="Les taux d'occupation VLAN apparaîtront ici lorsqu'ils seront disponibles." />
  </section>

  <section v-if="canWrite" class="panel" style="margin-top: 16px">
    <h2>Nouvelle cible</h2>
    <form class="grid" @submit.prevent="createTarget">
      <label>Équipement
        <select v-model="form.deviceId" required>
          <option value="">Choisir</option>
          <option v-for="device in availableDevices" :key="device.id" :value="device.id">{{ device.hostname }}</option>
        </select>
      </label>
      <label>Collecteur
        <select v-model="form.mode">
          <option value="SIMULATION">Simulation</option>
          <option value="ICMP">ICMP</option>
          <option value="SNMP">SNMP</option>
        </select>
      </label>
      <button type="submit">Ajouter la cible</button>
    </form>
  </section>
</template>
