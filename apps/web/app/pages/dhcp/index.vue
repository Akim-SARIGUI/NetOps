<script setup lang="ts">
import type { DhcpOverview, IpamOverview, ListResponse, Organization, Site } from "~/types/api";

definePageMeta({ layout: "console", middleware: "auth" });

const session = useSession();
const { data: organizations } = await useFetch<ListResponse<Organization>>("/api/backend/organizations");
const organizationId = ref(organizations.value?.data[0]?.id ?? "");
const siteId = ref("");
const canWrite = computed(() => can(session.value, organizationId.value, "inventory:write"));
const canDelete = computed(() => can(session.value, organizationId.value, "inventory:delete"));
const query = computed(() => (siteId.value ? { siteId: siteId.value } : {}));
const { data: sites } = await useFetch<ListResponse<Site>>(
  () => (organizationId.value ? `/api/backend/organizations/${organizationId.value}/sites` : null),
  { watch: [organizationId] },
);
const { data: dhcp, refresh } = await useFetch<DhcpOverview>(
  () => (organizationId.value ? `/api/backend/organizations/${organizationId.value}/dhcp` : null),
  { query, watch: [organizationId, query] },
);
const { data: ipam } = await useFetch<IpamOverview>(
  () => (organizationId.value ? `/api/backend/organizations/${organizationId.value}/ipam` : null),
  { query, watch: [organizationId, query] },
);

const message = ref("");
const serverForm = reactive({ siteId: "", name: "", address: "" });
const scopeForm = reactive({ subnetId: "", serverId: "", gateway: "", poolStart: "", poolEnd: "", dns: "", domain: "", leaseSeconds: 28800 });
const relayForm = reactive({ subnetId: "", serverId: "", helperAddress: "" });

const subnets = computed(() =>
  (ipam.value?.networks ?? []).flatMap((network) =>
    network.subnets
      .filter((subnet) => !dhcp.value?.scopes.some((scope) => scope.subnet.id === subnet.id))
      .map((subnet) => ({ id: subnet.id, label: `VLAN ${subnet.vlan.vid} ${subnet.vlan.name} · ${subnet.cidr}` })),
  ),
);

watch(organizationId, () => {
  siteId.value = "";
});
watch(
  () => relayForm.serverId,
  (serverId) => {
    const server = dhcp.value?.servers.find((item) => item.id === serverId);
    if (server?.address) relayForm.helperAddress = server.address;
  },
);

function percent(value: number) {
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(value);
}

function leaseLabel(seconds: number) {
  if (seconds % 86400 === 0) return `${seconds / 86400} j`;
  if (seconds % 3600 === 0) return `${seconds / 3600} h`;
  return `${seconds} s`;
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

function createServer() {
  return run(async () => {
    await $fetch(`/api/backend/organizations/${organizationId.value}/dhcp/servers`, {
      method: "POST",
      body: { siteId: serverForm.siteId, name: serverForm.name, address: serverForm.address || undefined, status: "PLANNED" },
    });
    serverForm.name = "";
    serverForm.address = "";
  });
}

function createScope() {
  return run(async () => {
    const dnsServers = scopeForm.dns.split(/[\s,]+/).filter(Boolean);
    await $fetch(`/api/backend/organizations/${organizationId.value}/dhcp/scopes`, {
      method: "POST",
      body: {
        subnetId: scopeForm.subnetId,
        serverId: scopeForm.serverId,
        gateway: scopeForm.gateway || undefined,
        dnsServers,
        domain: scopeForm.domain || undefined,
        leaseSeconds: Number(scopeForm.leaseSeconds),
        pool: { start: scopeForm.poolStart, end: scopeForm.poolEnd },
      },
    });
    scopeForm.gateway = "";
    scopeForm.poolStart = "";
    scopeForm.poolEnd = "";
    scopeForm.dns = "";
    scopeForm.domain = "";
  });
}

function createRelay() {
  return run(async () => {
    await $fetch(`/api/backend/organizations/${organizationId.value}/dhcp/relays`, { method: "POST", body: { ...relayForm } });
  });
}

function remove(path: string) {
  return run(async () => {
    await $fetch(path, { method: "DELETE" });
  });
}
</script>

<template>
  <header class="page-head">
    <div>
      <h1>DHCP</h1>
      <p class="lede">{{ dhcp?.notice }} Les scopes sont liés à un sous-réseau, donc à un VLAN.</p>
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
    <article class="metric"><span>Scopes</span><strong>{{ dhcp?.totals.scopes ?? 0 }}</strong></article>
    <article class="metric"><span>Baux</span><strong>{{ dhcp?.totals.activeLeases ?? 0 }}</strong></article>
    <article class="metric"><span>Utilisation</span><strong>{{ percent(dhcp?.totals.utilization ?? 0) }} %</strong></article>
    <article class="metric"><span>IP disponibles</span><strong>{{ dhcp?.totals.available ?? "0" }}</strong></article>
  </div>
  <section class="panel" style="margin-bottom: 16px">
    <h2>Alertes</h2>
    <ul v-if="dhcp?.alerts.length">
      <li v-for="alert in dhcp.alerts" :key="alert.scopeId + alert.code + alert.message">
        VLAN {{ alert.vlan.vid }} · {{ alert.cidr }} · {{ alert.message }}
      </li>
    </ul>
    <p v-else class="empty">Aucune alerte.</p>
  </section>

  <section class="panel">
    <h2>Scopes</h2>
    <table v-if="dhcp?.scopes.length">
      <thead>
        <tr>
          <th>VLAN</th>
          <th>Sous-réseau</th>
          <th>Passerelle</th>
          <th>Pool</th>
          <th>DNS</th>
          <th>Domaine</th>
          <th>Bail</th>
          <th>Disponibles</th>
          <th>Utilisation</th>
          <th v-if="canDelete"></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="scope in dhcp.scopes" :key="scope.id">
          <td><NuxtLink class="row-link" :to="`/vlans/${scope.vlan.id}`">{{ scope.vlan.vid }} {{ scope.vlan.name }}</NuxtLink></td>
          <td><NuxtLink class="row-link" :to="`/dhcp/scopes/${scope.id}`">{{ scope.subnet.cidr }}</NuxtLink></td>
          <td class="mono">{{ scope.gateway }}</td>
          <td class="mono">{{ scope.pools.map((pool) => `${pool.start} → ${pool.end}`).join(", ") || "—" }}</td>
          <td class="mono">{{ scope.dnsServers.join(", ") || "—" }}</td>
          <td>{{ scope.domain || "—" }}</td>
          <td>{{ leaseLabel(scope.leaseSeconds) }}</td>
          <td>{{ scope.stats.available }}</td>
          <td>
            <div class="util"><div class="util-bar"><span :style="{ width: `${Math.min(scope.stats.utilization, 100)}%` }"></span></div> {{ percent(scope.stats.utilization) }} %</div>
          </td>
          <td v-if="canDelete"><button class="danger" type="button" @click="remove(`/api/backend/dhcp/scopes/${scope.id}`)">Retirer</button></td>
        </tr>
      </tbody>
    </table>
    <p v-else class="empty">Aucun scope.</p>
  </section>

  <section class="panel" style="margin-top: 16px">
    <h2>Baux simulés</h2>
    <table v-if="dhcp?.leases.length">
      <thead>
        <tr><th>Adresse</th><th>MAC</th><th>Hôte</th><th>VLAN</th><th>Origine</th></tr>
      </thead>
      <tbody>
        <tr v-for="lease in dhcp.leases" :key="lease.id">
          <td class="mono">{{ lease.address }}</td>
          <td class="mono">{{ lease.macAddress }}</td>
          <td>{{ lease.hostname || "—" }}</td>
          <td>VLAN {{ lease.vlan.vid }}</td>
          <td>{{ lease.origin === "SIMULATION" ? "Simulation" : lease.origin }}</td>
        </tr>
      </tbody>
    </table>
    <p v-else class="empty">Aucun bail actif.</p>
  </section>

  <div class="grid" style="margin-top: 16px">
    <section class="panel">
      <h2>Serveurs</h2>
      <ul v-if="dhcp?.servers.length">
        <li v-for="server in dhcp.servers" :key="server.id">
          <strong>{{ server.name }}</strong>
          <span class="mono"> {{ server.address || "sans adresse" }}</span>
          · {{ server.site.name }}
          <span v-if="server.device"> · {{ server.device.hostname }}</span>
          <span class="hint"> · état prévu {{ server.status }}</span>
          <button v-if="canDelete && server.counts.scopes === 0 && server.counts.relays === 0" class="danger" type="button" @click="remove(`/api/backend/dhcp/servers/${server.id}`)">Retirer</button>
        </li>
      </ul>
      <p v-else class="empty">Aucun serveur.</p>
    </section>
    <section class="panel">
      <h2>Relais</h2>
      <ul v-if="dhcp?.relays.length">
        <li v-for="relay in dhcp.relays" :key="relay.id">
          VLAN {{ relay.subnet.vlan.vid }} {{ relay.subnet.cidr }} → <span class="mono">{{ relay.helperAddress }}</span>
          · {{ relay.server.name }}
          <span v-if="relay.interface"> · {{ relay.interface.device.hostname }} {{ relay.interface.name }}</span>
          <button v-if="canDelete" class="danger" type="button" @click="remove(`/api/backend/dhcp/relays/${relay.id}`)">Retirer</button>
        </li>
      </ul>
      <p v-else class="empty">Aucun relais.</p>
    </section>
  </div>

  <div v-if="canWrite" class="grid" style="margin-top: 16px">
    <form class="panel" @submit.prevent="createServer">
      <h2>Nouveau serveur</h2>
      <label>Site <select v-model="serverForm.siteId" required><option disabled value="">Choisir</option><option v-for="site in sites?.data ?? []" :key="site.id" :value="site.id">{{ site.name }}</option></select></label>
      <label>Nom <input v-model="serverForm.name" required /></label>
      <label>Adresse <input v-model="serverForm.address" placeholder="192.168.40.10" /></label>
      <button class="primary" type="submit">Créer le serveur</button>
    </form>
    <form class="panel" @submit.prevent="createScope">
      <h2>Nouveau scope</h2>
      <label>Sous-réseau <select v-model="scopeForm.subnetId" required><option disabled value="">Choisir</option><option v-for="subnet in subnets" :key="subnet.id" :value="subnet.id">{{ subnet.label }}</option></select></label>
      <label>Serveur <select v-model="scopeForm.serverId" required><option disabled value="">Choisir</option><option v-for="server in dhcp?.servers ?? []" :key="server.id" :value="server.id">{{ server.name }}</option></select></label>
      <label>Passerelle <input v-model="scopeForm.gateway" placeholder="192.168.20.1" /></label>
      <label>Début du pool <input v-model="scopeForm.poolStart" placeholder="192.168.20.100" required /></label>
      <label>Fin du pool <input v-model="scopeForm.poolEnd" placeholder="192.168.20.200" required /></label>
      <label>DNS <input v-model="scopeForm.dns" placeholder="192.168.40.10" /></label>
      <label>Domaine <input v-model="scopeForm.domain" placeholder="netops.local" /></label>
      <label>Durée du bail (secondes) <input v-model.number="scopeForm.leaseSeconds" type="number" min="60" required /></label>
      <button class="primary" type="submit">Créer le scope</button>
    </form>
    <form class="panel" @submit.prevent="createRelay">
      <h2>Nouveau relais</h2>
      <label>Sous-réseau <select v-model="relayForm.subnetId" required><option disabled value="">Choisir</option><option v-for="scope in dhcp?.scopes ?? []" :key="scope.id" :value="scope.subnet.id">VLAN {{ scope.vlan.vid }} · {{ scope.subnet.cidr }}</option></select></label>
      <label>Serveur <select v-model="relayForm.serverId" required><option disabled value="">Choisir</option><option v-for="server in dhcp?.servers ?? []" :key="server.id" :value="server.id">{{ server.name }}</option></select></label>
      <label>Adresse helper <input v-model="relayForm.helperAddress" required /></label>
      <button class="primary" type="submit">Créer le relais</button>
    </form>
  </div>
</template>
