<script setup lang="ts">
import type { Device, ListResponse, Organization, Site, Vlan, VlanRole, SecurityZone, VlanStatus } from "~/types/api";

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
const vlanQuery = computed(() => (siteId.value ? { siteId: siteId.value } : {}));
const { data: vlans, refresh: refreshVlans } = await useFetch<ListResponse<Vlan>>(
  () => (organizationId.value ? `/api/backend/organizations/${organizationId.value}/vlans` : null),
  { query: vlanQuery, watch: [organizationId, vlanQuery] },
);
const switchQuery = computed(() => (siteId.value ? { role: "SWITCH", siteId: siteId.value } : { role: "SWITCH" }));
const { data: switches, refresh: refreshSwitches } = await useFetch<ListResponse<Device>>(
  () => (organizationId.value ? `/api/backend/organizations/${organizationId.value}/devices` : null),
  { query: switchQuery, watch: [organizationId, switchQuery] },
);

const message = ref("");
const form = reactive({
  vid: 10,
  name: "",
  description: "",
  role: "DATA" as VlanRole,
  securityZone: "TRUST" as SecurityZone,
  status: "ACTIVE" as VlanStatus,
  cidr: "",
  gateway: "",
});

watch(sites, (value) => {
  if (!siteId.value && value?.data[0]) siteId.value = value.data[0].id;
}, { immediate: true });

watch(organizationId, () => {
  siteId.value = "";
});

async function createVlan() {
  message.value = "";
  try {
    await $fetch(`/api/backend/organizations/${organizationId.value}/vlans`, {
      method: "POST",
      body: {
        siteId: siteId.value,
        vid: Number(form.vid),
        name: form.name,
        description: form.description || null,
        role: form.role,
        securityZone: form.securityZone,
        status: form.status,
        cidr: form.cidr || undefined,
        gateway: form.gateway || undefined,
      },
    });
    form.name = "";
    form.description = "";
    form.cidr = "";
    form.gateway = "";
    await refreshVlans();
  } catch (error) {
    message.value = apiErrorMessage(error);
  }
}

async function removeVlan(vlanId: string) {
  message.value = "";
  try {
    await $fetch(`/api/backend/vlans/${vlanId}`, { method: "DELETE" });
    await refreshVlans();
  } catch (error) {
    message.value = apiErrorMessage(error);
  }
}
</script>

<template>
  <header class="page-head">
    <div>
      <h1>Commutation</h1>
      <p class="lede">VLAN d'un site et commutateurs qui les portent.</p>
    </div>
    <label v-if="(organizations?.data.length ?? 0) > 1">
      Organisation
      <select v-model="organizationId">
        <option v-for="organization in organizations?.data ?? []" :key="organization.id" :value="organization.id">
          {{ organization.name }}
        </option>
      </select>
    </label>
  </header>

  <form class="filters panel" @submit.prevent="refreshSwitches">
    <label>
      Site
      <select v-model="siteId">
        <option value="">Tous</option>
        <option v-for="site in sites?.data ?? []" :key="site.id" :value="site.id">{{ site.name }}</option>
      </select>
    </label>
  </form>

  <div class="grid">
    <section class="panel">
      <h2>VLAN</h2>
      <p v-if="message" class="banner">{{ message }}</p>
      <table v-if="vlans?.data.length">
        <thead>
          <tr>
            <th>ID</th>
            <th>Nom</th>
            <th>Usage</th>
            <th>Zone</th>
            <th>Sous-réseau</th>
            <th>Statut</th>
            <th>Ports</th>
            <th v-if="canDelete"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="vlan in vlans.data" :key="vlan.id">
            <td class="mono">{{ vlan.vid }}</td>
            <td><NuxtLink class="row-link" :to="`/vlans/${vlan.id}`">{{ vlan.name }}</NuxtLink></td>
            <td>{{ vlanRoleLabels[vlan.role] }}</td>
            <td>{{ securityZoneLabels[vlan.securityZone] }}</td>
            <td class="mono">{{ vlan.subnets?.map((subnet) => subnet.cidr).join(", ") || "—" }}</td>
            <td><span class="pill" :class="vlan.status">{{ vlanStatusLabels[vlan.status] }}</span></td>
            <td>{{ vlan.usage ?? 0 }}</td>
            <td v-if="canDelete">
              <button class="danger" type="button" @click="removeVlan(vlan.id)">Retirer</button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else class="empty">Aucun VLAN sur ce site.</p>
    </section>

    <div class="stack">
      <form v-if="canWrite" class="panel" @submit.prevent="createVlan">
        <h2>Nouveau VLAN</h2>
        <label>
          Site
          <select v-model="siteId" required>
            <option v-for="site in sites?.data ?? []" :key="site.id" :value="site.id">{{ site.name }}</option>
          </select>
        </label>
        <label>VLAN ID <input v-model.number="form.vid" type="number" min="1" max="4094" required /></label>
        <label>Nom <input v-model="form.name" required maxlength="64" /></label>
        <label>Description <input v-model="form.description" /></label>
        <label>
          Usage
          <select v-model="form.role">
            <option v-for="(label, role) in vlanRoleLabels" :key="role" :value="role">{{ label }}</option>
          </select>
        </label>
        <label>
          Zone de sécurité
          <select v-model="form.securityZone">
            <option v-for="(label, zone) in securityZoneLabels" :key="zone" :value="zone">{{ label }}</option>
          </select>
        </label>
        <label>Sous-réseau <input v-model="form.cidr" placeholder="192.168.20.0/24" /></label>
        <label>Passerelle <input v-model="form.gateway" placeholder="192.168.20.1" /></label>
        <label>
          Statut
          <select v-model="form.status">
            <option v-for="(label, status) in vlanStatusLabels" :key="status" :value="status">{{ label }}</option>
          </select>
        </label>
        <button class="primary" type="submit" :disabled="!siteId">Créer le VLAN</button>
      </form>

      <section class="panel">
        <h2>Commutateurs</h2>
        <table v-if="switches?.data.length">
          <thead>
            <tr>
              <th>Nom</th>
              <th>Site</th>
              <th>Statut</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="device in switches.data" :key="device.id">
              <td><NuxtLink class="row-link" :to="`/switches/${device.id}`">{{ device.hostname }}</NuxtLink></td>
              <td>{{ device.site.name }}</td>
              <td><span class="pill" :class="device.status">{{ statusLabels[device.status] }}</span></td>
            </tr>
          </tbody>
        </table>
        <p v-else class="empty">Aucun commutateur.</p>
      </section>
    </div>
  </div>
</template>
