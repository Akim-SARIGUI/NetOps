<script setup lang="ts">
import type { Device, DeviceRole, DeviceStatus, InventorySummary, ListResponse, Organization, Site } from "~/types/api";

definePageMeta({ layout: "console", middleware: "auth" });

const session = useSession();
const { data: organizations } = await useFetch<ListResponse<Organization>>("/api/backend/organizations");
const organizationId = ref(organizations.value?.data[0]?.id ?? "");
const canWrite = computed(() => can(session.value, organizationId.value, "inventory:write"));

const filters = reactive({ q: "", role: "", status: "", siteId: "" });
const applied = ref({ q: "", role: "", status: "", siteId: "" });

const { data: summary, refresh: refreshSummary } = await useFetch<InventorySummary>(
  () => (organizationId.value ? `/api/backend/organizations/${organizationId.value}/inventory` : null),
  { watch: [organizationId] },
);
const { data: sites } = await useFetch<ListResponse<Site>>(
  () => (organizationId.value ? `/api/backend/organizations/${organizationId.value}/sites` : null),
  { watch: [organizationId] },
);
const { data: devices, refresh: refreshDevices } = await useFetch<ListResponse<Device>>(
  () => (organizationId.value ? `/api/backend/organizations/${organizationId.value}/devices` : null),
  { query: applied, watch: [organizationId, applied] },
);

const message = ref("");
const form = reactive({
  role: "SWITCH" as DeviceRole,
  hostname: "",
  managementIp: "",
  vendor: "",
  model: "",
  os: "",
  osVersion: "",
  serialNumber: "",
  status: "PLANNED" as DeviceStatus,
  description: "",
  siteId: "",
  buildingId: null as string | null,
  roomId: null as string | null,
  rackId: null as string | null,
});

function applyFilters() {
  applied.value = { ...filters };
}

watch(organizationId, () => {
  filters.siteId = "";
  form.siteId = "";
  form.buildingId = null;
  form.roomId = null;
  form.rackId = null;
  applyFilters();
});

async function reload() {
  await Promise.all([refreshDevices(), refreshSummary()]);
}

async function createDevice() {
  message.value = "";
  try {
    await $fetch(`/api/backend/organizations/${organizationId.value}/devices`, {
      method: "POST",
      body: {
        ...form,
        managementIp: form.managementIp || null,
        vendor: form.vendor || null,
        model: form.model || null,
        os: form.os || null,
        osVersion: form.osVersion || null,
        serialNumber: form.serialNumber || null,
        description: form.description || null,
      },
    });
    form.hostname = "";
    form.managementIp = "";
    form.serialNumber = "";
    form.description = "";
    await reload();
  } catch (error) {
    message.value = apiErrorMessage(error);
  }
}
</script>

<template>
  <header class="page-head">
    <div>
      <h1>Inventaire</h1>
      <p class="lede">Routeurs, commutateurs, pare-feux, serveurs, points d'accès et clients.</p>
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

  <section class="stats">
    <article class="stat"><span>Équipements</span><strong>{{ summary?.devices ?? 0 }}</strong></article>
    <article class="stat"><span>Interfaces</span><strong>{{ summary?.interfaces ?? 0 }}</strong></article>
    <article v-for="(label, role) in roleLabels" :key="role" class="stat">
      <span>{{ label }}</span>
      <strong>{{ summary?.byRole[role] ?? 0 }}</strong>
    </article>
  </section>

  <form class="filters panel" @submit.prevent="applyFilters">
    <label>Recherche <input v-model="filters.q" placeholder="Nom, IP, série, constructeur" /></label>
    <label>
      Rôle
      <select v-model="filters.role">
        <option value="">Tous</option>
        <option v-for="(label, role) in roleLabels" :key="role" :value="role">{{ label }}</option>
      </select>
    </label>
    <label>
      Statut
      <select v-model="filters.status">
        <option value="">Tous</option>
        <option v-for="(label, status) in statusLabels" :key="status" :value="status">{{ label }}</option>
      </select>
    </label>
    <label>
      Site
      <select v-model="filters.siteId">
        <option value="">Tous</option>
        <option v-for="site in sites?.data ?? []" :key="site.id" :value="site.id">{{ site.name }}</option>
      </select>
    </label>
    <button class="primary" type="submit">Filtrer</button>
  </form>

  <div class="grid">
    <section class="panel">
      <table v-if="devices?.data.length">
        <thead>
          <tr>
            <th>Nom</th>
            <th>Rôle</th>
            <th>IP</th>
            <th>Statut</th>
            <th>Emplacement</th>
            <th>Interfaces</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="device in devices.data" :key="device.id">
            <td><NuxtLink class="row-link" :to="`/devices/${device.id}`">{{ device.hostname }}</NuxtLink></td>
            <td>{{ roleLabels[device.role] }}</td>
            <td class="mono">{{ device.managementIp ?? "—" }}</td>
            <td>
              <AppBadge
                :tone="device.status === 'ACTIVE' ? 'success' : device.status === 'MAINTENANCE' ? 'warning' : device.status === 'DECOMMISSIONED' ? 'danger' : 'neutral'"
                :label="statusLabels[device.status]"
              />
            </td>
            <td>{{ locationLabel(device) }}</td>
            <td>{{ device.counts?.interfaces ?? 0 }}</td>
          </tr>
        </tbody>
      </table>
      <AppEmpty
        v-else
        title="Aucun équipement pour ces critères."
        description="Ajustez les filtres ou ajoutez un équipement à l'inventaire."
      />
    </section>

    <form v-if="canWrite" class="panel" @submit.prevent="createDevice">
      <h2>Nouvel équipement</h2>
      <p v-if="message" class="banner">{{ message }}</p>
      <label>
        Rôle
        <select v-model="form.role">
          <option v-for="(label, role) in roleLabels" :key="role" :value="role">{{ label }}</option>
        </select>
      </label>
      <label>Nom d'hôte <input v-model="form.hostname" required /></label>
      <label>IP de management <input v-model="form.managementIp" placeholder="optionnelle" /></label>
      <label>Constructeur <input v-model="form.vendor" /></label>
      <label>Modèle <input v-model="form.model" /></label>
      <label>OS <input v-model="form.os" /></label>
      <label>Version <input v-model="form.osVersion" /></label>
      <label>Numéro de série <input v-model="form.serialNumber" /></label>
      <label>
        Statut
        <select v-model="form.status">
          <option v-for="(label, status) in statusLabels" :key="status" :value="status">{{ label }}</option>
        </select>
      </label>
      <label>Description <input v-model="form.description" /></label>
      <LocationFields
        v-if="organizationId"
        :organization-id="organizationId"
        v-model:site-id="form.siteId"
        v-model:building-id="form.buildingId"
        v-model:room-id="form.roomId"
        v-model:rack-id="form.rackId"
      />
      <button class="primary" type="submit">Ajouter</button>
    </form>
  </div>
</template>
