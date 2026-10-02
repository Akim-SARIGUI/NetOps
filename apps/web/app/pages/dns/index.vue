<script setup lang="ts">
import type { DnsOverview, IpamOverview, ListResponse, Organization, Site } from "~/types/api";

definePageMeta({ layout: "console", middleware: "auth" });

const session = useSession();
const { data: organizations } = await useFetch<ListResponse<Organization>>("/api/backend/organizations");
const organizationId = ref(organizations.value?.data[0]?.id ?? "");
const siteId = ref("");
const q = ref("");
const canWrite = computed(() => can(session.value, organizationId.value, "inventory:write"));
const canDelete = computed(() => can(session.value, organizationId.value, "inventory:delete"));
const query = computed(() => ({ ...(siteId.value ? { siteId: siteId.value } : {}), ...(q.value.trim() ? { q: q.value.trim() } : {}) }));
const { data: sites } = await useFetch<ListResponse<Site>>(
  () => (organizationId.value ? `/api/backend/organizations/${organizationId.value}/sites` : null),
  { watch: [organizationId] },
);
const { data: dns, refresh } = await useFetch<DnsOverview>(
  () => (organizationId.value ? `/api/backend/organizations/${organizationId.value}/dns` : null),
  { query, watch: [organizationId, query] },
);
const { data: ipam } = await useFetch<IpamOverview>(
  () => (organizationId.value ? `/api/backend/organizations/${organizationId.value}/ipam` : null),
  { watch: [organizationId] },
);

const message = ref("");
const serverForm = reactive({ siteId: "", name: "", address: "" });
const forwardForm = reactive({ serverId: "", name: "" });
const reverseForm = reactive({ serverId: "", subnetId: "" });
const subnets = computed(() =>
  (ipam.value?.networks ?? []).flatMap((network) =>
    network.subnets
      .filter((subnet) => !dns.value?.zones.some((zone) => zone.subnet?.id === subnet.id))
      .map((subnet) => ({ id: subnet.id, label: `VLAN ${subnet.vlan.vid} ${subnet.vlan.name} · ${subnet.cidr}` })),
  ),
);

watch(organizationId, () => {
  siteId.value = "";
});

async function run(action: () => Promise<void>) {
  message.value = "";
  try {
    await action();
    await refresh();
  } catch (error) {
    message.value = apiErrorMessage(error);
  }
}

function createServer() {
  return run(async () => {
    await $fetch(`/api/backend/organizations/${organizationId.value}/dns/servers`, {
      method: "POST",
      body: { siteId: serverForm.siteId, name: serverForm.name, address: serverForm.address || undefined, status: "PLANNED" },
    });
    serverForm.name = "";
    serverForm.address = "";
  });
}

function createForward() {
  return run(async () => {
    await $fetch(`/api/backend/organizations/${organizationId.value}/dns/zones`, {
      method: "POST",
      body: { serverId: forwardForm.serverId, kind: "FORWARD", name: forwardForm.name },
    });
    forwardForm.name = "";
  });
}

function createReverse() {
  return run(async () => {
    await $fetch(`/api/backend/organizations/${organizationId.value}/dns/zones`, {
      method: "POST",
      body: { serverId: reverseForm.serverId, kind: "REVERSE", subnetId: reverseForm.subnetId },
    });
    reverseForm.subnetId = "";
  });
}

function remove(path: string) {
  return run(() => $fetch(path, { method: "DELETE" }));
}
</script>

<template>
  <header class="page-head">
    <div>
      <h1>DNS</h1>
      <p class="lede">{{ dns?.notice }}</p>
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
    <article class="metric"><span>Zones</span><strong>{{ dns?.totals.zones ?? 0 }}</strong></article>
    <article class="metric"><span>Enregistrements</span><strong>{{ dns?.totals.records ?? 0 }}</strong></article>
    <article class="metric"><span>Serveurs</span><strong>{{ dns?.totals.servers ?? 0 }}</strong></article>
    <article class="metric"><span>Alertes</span><strong>{{ dns?.totals.alerts ?? 0 }}</strong></article>
  </div>
  <section class="panel" style="margin-bottom: 16px">
    <h2>Recherche</h2>
    <label>Nom, valeur ou zone <input v-model="q" placeholder="intranet.entreprise.local" /></label>
  </section>
  <section class="panel" style="margin-bottom: 16px">
    <h2>Alertes</h2>
    <ul v-if="dns?.alerts.length">
      <li v-for="alert in dns.alerts" :key="alert.zoneId + alert.code + alert.message">{{ alert.zone }} · {{ alert.message }}</li>
    </ul>
    <p v-else class="empty">Aucune alerte.</p>
  </section>
  <section class="panel">
    <h2>Zones</h2>
    <table v-if="dns?.zones.length">
      <thead>
        <tr>
          <th>Zone</th>
          <th>Type</th>
          <th>Sous-réseau</th>
          <th>Enregistrements</th>
          <th>Serveur</th>
          <th v-if="canDelete"></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="zone in dns.zones" :key="zone.id">
          <td><NuxtLink class="row-link" :to="`/dns/zones/${zone.id}`">{{ zone.name }}</NuxtLink></td>
          <td>{{ zone.kind === 'FORWARD' ? 'Directe' : 'Inverse' }}</td>
          <td class="mono">{{ zone.subnet ? `VLAN ${zone.subnet.vlan.vid} · ${zone.subnet.cidr}` : "—" }}</td>
          <td>{{ zone.records.length }}</td>
          <td>{{ zone.server.name }}</td>
          <td v-if="canDelete"><button class="danger" type="button" @click="remove(`/api/backend/dns/zones/${zone.id}`)">Retirer</button></td>
        </tr>
      </tbody>
    </table>
    <p v-else class="empty">Aucune zone.</p>
  </section>
  <section class="panel" style="margin-top: 16px">
    <h2>Serveurs</h2>
    <ul v-if="dns?.servers.length">
      <li v-for="server in dns.servers" :key="server.id">
        <strong>{{ server.name }}</strong>
        <span class="mono"> {{ server.address || "sans adresse" }}</span>
        · {{ server.site.name }}
        <span v-if="server.device"> · {{ server.device.hostname }}</span>
        <span class="hint"> · état prévu {{ server.status }} · résolution locale</span>
        <button v-if="canDelete && server.counts.zones === 0" class="danger" type="button" @click="remove(`/api/backend/dns/servers/${server.id}`)">Retirer</button>
      </li>
    </ul>
    <p v-else class="empty">Aucun serveur.</p>
  </section>
  <div v-if="canWrite" class="grid" style="margin-top: 16px">
    <form class="panel" @submit.prevent="createServer">
      <h2>Nouveau serveur</h2>
      <label>Site <select v-model="serverForm.siteId" required><option disabled value="">Choisir</option><option v-for="site in sites?.data ?? []" :key="site.id" :value="site.id">{{ site.name }}</option></select></label>
      <label>Nom <input v-model="serverForm.name" required /></label>
      <label>Adresse <input v-model="serverForm.address" placeholder="10.0.0.10" /></label>
      <button class="primary" type="submit">Créer le serveur</button>
    </form>
    <form class="panel" @submit.prevent="createForward">
      <h2>Nouvelle zone</h2>
      <label>Serveur <select v-model="forwardForm.serverId" required><option disabled value="">Choisir</option><option v-for="server in dns?.servers ?? []" :key="server.id" :value="server.id">{{ server.name }}</option></select></label>
      <label>Nom <input v-model="forwardForm.name" placeholder="entreprise.local" required /></label>
      <button class="primary" type="submit">Créer la zone directe</button>
    </form>
    <form class="panel" @submit.prevent="createReverse">
      <h2>Zone inverse</h2>
      <label>Serveur <select v-model="reverseForm.serverId" required><option disabled value="">Choisir</option><option v-for="server in dns?.servers ?? []" :key="server.id" :value="server.id">{{ server.name }}</option></select></label>
      <label>Sous-réseau <select v-model="reverseForm.subnetId" required><option disabled value="">Choisir</option><option v-for="subnet in subnets" :key="subnet.id" :value="subnet.id">{{ subnet.label }}</option></select></label>
      <button class="primary" type="submit">Créer la zone inverse</button>
    </form>
  </div>
</template>
