<script setup lang="ts">
import type { IpamOverview, ListResponse, Organization, Site, Vlan } from "~/types/api";

definePageMeta({ layout: "console", middleware: "auth" });

const session = useSession();
const { data: organizations } = await useFetch<ListResponse<Organization>>("/api/backend/organizations");
const organizationId = ref(organizations.value?.data[0]?.id ?? "");
const siteId = ref("");
const canWrite = computed(() => can(session.value, organizationId.value, "inventory:write"));
const canDelete = computed(() => can(session.value, organizationId.value, "inventory:delete"));

const { data: sites } = await useFetch<ListResponse<Site>>(
  () => (organizationId.value ? `/api/backend/organizations/${organizationId.value}/sites` : null),
  { watch: [organizationId] },
);
const ipamQuery = computed(() => (siteId.value ? { siteId: siteId.value } : {}));
const { data: ipam, refresh } = await useFetch<IpamOverview>(
  () => (organizationId.value ? `/api/backend/organizations/${organizationId.value}/ipam` : null),
  { query: ipamQuery, watch: [organizationId, ipamQuery] },
);
const vlanQuery = computed(() => (siteId.value ? { siteId: siteId.value } : {}));
const { data: vlans } = await useFetch<ListResponse<Vlan>>(
  () => (organizationId.value ? `/api/backend/organizations/${organizationId.value}/vlans` : null),
  { query: vlanQuery, watch: [organizationId, vlanQuery] },
);

const message = ref("");
const networkForm = reactive({ name: "", cidr: "", description: "" });
const subnetForm = reactive({ networkId: "", vlanId: "", name: "", cidr: "", gateway: "", description: "" });

watch(organizationId, () => {
  siteId.value = "";
});

function percent(value: number) {
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(value);
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

function createNetwork() {
  return run(async () => {
    await $fetch(`/api/backend/organizations/${organizationId.value}/networks`, {
      method: "POST",
      body: { siteId: siteId.value, name: networkForm.name, cidr: networkForm.cidr, description: networkForm.description || null },
    });
    networkForm.name = "";
    networkForm.cidr = "";
    networkForm.description = "";
  });
}

function createSubnet() {
  return run(async () => {
    await $fetch(`/api/backend/organizations/${organizationId.value}/subnets`, {
      method: "POST",
      body: { ...subnetForm, description: subnetForm.description || null },
    });
    subnetForm.name = "";
    subnetForm.cidr = "";
    subnetForm.gateway = "";
    subnetForm.description = "";
  });
}

function removeNetwork(id: string) {
  return run(async () => {
    await $fetch(`/api/backend/networks/${id}`, { method: "DELETE" });
  });
}
</script>

<template>
  <header class="page-head">
    <div>
      <h1>Adressage</h1>
      <p class="lede">Réseaux, sous-réseaux, passerelles et adresses. <NuxtLink class="row-link" to="/ipam/calculator">Calculateur CIDR / VLSM</NuxtLink></p>
    </div>
    <label v-if="(organizations?.data.length ?? 0) > 1">
      Organisation
      <select v-model="organizationId">
        <option v-for="organization in organizations?.data ?? []" :key="organization.id" :value="organization.id">{{ organization.name }}</option>
      </select>
    </label>
  </header>

  <form class="filters panel" @submit.prevent="refresh">
    <label>
      Site
      <select v-model="siteId">
        <option value="">Tous</option>
        <option v-for="site in sites?.data ?? []" :key="site.id" :value="site.id">{{ site.name }}</option>
      </select>
    </label>
  </form>
  <p v-if="message" class="banner">{{ message }}</p>
  <section v-if="ipam?.orphans.length" class="panel" style="margin-bottom: 16px">
    <h2>Adresses hors plan</h2>
    <ul>
      <li v-for="orphan in ipam.orphans" :key="orphan.interface.id">{{ orphan.message }}</li>
    </ul>
  </section>

  <div class="grid">
    <section class="panel">
      <h2>Réseaux et sous-réseaux</h2>
      <div v-if="ipam?.networks.length" class="stack">
        <article v-for="network in ipam.networks" :key="network.id">
          <header class="actions">
            <strong>{{ network.name }}</strong>
            <span class="mono">{{ network.cidr }}</span>
            <span class="hint">{{ network.site.name }}</span>
            <button v-if="canDelete && network.subnets.length === 0" class="danger" type="button" @click="removeNetwork(network.id)">Retirer</button>
          </header>
          <table v-if="network.subnets.length">
            <thead>
              <tr>
                <th>Sous-réseau</th>
                <th>VLAN</th>
                <th>Utilisables</th>
                <th>Occupation</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="subnet in network.subnets" :key="subnet.id">
                <td>
                  <NuxtLink class="row-link" :to="`/subnets/${subnet.id}`">{{ subnet.name }}</NuxtLink>
                  <div class="mono">{{ subnet.cidr }}</div>
                </td>
                <td>{{ subnet.vlan.vid }} · {{ subnet.vlan.name }}</td>
                <td class="mono">{{ subnet.stats.used }} / {{ subnet.stats.usable }}</td>
                <td>
                  <div class="util">
                    <div class="util-bar"><span :style="{ width: `${Math.min(subnet.stats.utilization, 100)}%` }" /></div>
                    <span class="mono">{{ percent(subnet.stats.utilization) }} %</span>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
          <p v-else class="empty">Aucun sous-réseau.</p>
        </article>
      </div>
      <p v-else class="empty">Aucun réseau sur ce site.</p>
    </section>

    <div v-if="canWrite" class="stack">
      <form class="panel" @submit.prevent="createNetwork">
        <h2>Nouveau réseau</h2>
        <label>
          Site
          <select v-model="siteId" required>
            <option v-for="site in sites?.data ?? []" :key="site.id" :value="site.id">{{ site.name }}</option>
          </select>
        </label>
        <label>Nom <input v-model="networkForm.name" required /></label>
        <label>CIDR <input v-model="networkForm.cidr" placeholder="10.2.0.0/16" required /></label>
        <label>Description <input v-model="networkForm.description" /></label>
        <button class="primary" type="submit" :disabled="!siteId">Créer le réseau</button>
      </form>
      <form class="panel" @submit.prevent="createSubnet">
        <h2>Nouveau sous-réseau</h2>
        <label>
          Réseau
          <select v-model="subnetForm.networkId" required>
            <option value="" disabled>Choisir</option>
            <option v-for="network in ipam?.networks ?? []" :key="network.id" :value="network.id">{{ network.name }} · {{ network.cidr }}</option>
          </select>
        </label>
        <label>
          VLAN
          <select v-model="subnetForm.vlanId" required>
            <option value="" disabled>Choisir</option>
            <option v-for="vlan in vlans?.data ?? []" :key="vlan.id" :value="vlan.id">{{ vlan.vid }} · {{ vlan.name }}</option>
          </select>
        </label>
        <label>Nom <input v-model="subnetForm.name" required /></label>
        <label>CIDR <input v-model="subnetForm.cidr" placeholder="10.2.10.0/24" required /></label>
        <label>Passerelle <input v-model="subnetForm.gateway" placeholder="10.2.10.1" required /></label>
        <label>Description <input v-model="subnetForm.description" /></label>
        <button class="primary" type="submit">Créer le sous-réseau</button>
      </form>
    </div>
  </div>
</template>
