<script setup lang="ts">
import type { Device, DeviceRole, DeviceStatus, Duplex, InterfaceStatus, ListResponse, NetworkInterface } from "~/types/api";

definePageMeta({ layout: "console", middleware: "auth" });

const route = useRoute();
const session = useSession();
const deviceId = computed(() => String(route.params.deviceId));
const message = ref("");
const interfaceQuery = ref("");

const { data: device, refresh: refreshDevice } = await useFetch<Device>(() => `/api/backend/devices/${deviceId.value}`);
const organizationId = computed(() => device.value?.organizationId ?? "");
const canWrite = computed(() => can(session.value, organizationId.value, "inventory:write"));
const canDelete = computed(() => can(session.value, organizationId.value, "inventory:delete"));

const { data: interfaces, refresh: refreshInterfaces } = await useFetch<ListResponse<NetworkInterface>>(
  () => `/api/backend/devices/${deviceId.value}/interfaces`,
  { query: computed(() => (interfaceQuery.value ? { q: interfaceQuery.value } : {})), watch: [interfaceQuery] },
);

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

const iface = reactive({
  name: "",
  ipAddress: "",
  macAddress: "",
  speedMbps: null as number | null,
  duplex: "" as Duplex | "",
  status: "DOWN" as InterfaceStatus,
  description: "",
});

watch(
  device,
  (value) => {
    if (!value) return;
    form.role = value.role;
    form.hostname = value.hostname;
    form.managementIp = value.managementIp ?? "";
    form.vendor = value.vendor ?? "";
    form.model = value.model ?? "";
    form.os = value.os ?? "";
    form.osVersion = value.osVersion ?? "";
    form.serialNumber = value.serialNumber ?? "";
    form.status = value.status;
    form.description = value.description ?? "";
    form.siteId = value.site.id;
    form.buildingId = value.building?.id ?? null;
    form.roomId = value.room?.id ?? null;
    form.rackId = value.rack?.id ?? null;
  },
  { immediate: true },
);

async function saveDevice() {
  message.value = "";
  try {
    await $fetch(`/api/backend/devices/${deviceId.value}`, {
      method: "PATCH",
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
    await refreshDevice();
  } catch (error) {
    message.value = apiErrorMessage(error);
  }
}

async function removeDevice() {
  message.value = "";
  try {
    await $fetch(`/api/backend/devices/${deviceId.value}`, { method: "DELETE" });
    await navigateTo("/inventory");
  } catch (error) {
    message.value = apiErrorMessage(error);
  }
}

async function createInterface() {
  message.value = "";
  try {
    await $fetch(`/api/backend/devices/${deviceId.value}/interfaces`, {
      method: "POST",
      body: {
        name: iface.name,
        ipAddress: iface.ipAddress || null,
        macAddress: iface.macAddress || null,
        speedMbps: iface.speedMbps,
        duplex: iface.duplex || null,
        status: iface.status,
        description: iface.description || null,
      },
    });
    iface.name = "";
    iface.ipAddress = "";
    iface.macAddress = "";
    iface.speedMbps = null;
    iface.description = "";
    await Promise.all([refreshInterfaces(), refreshDevice()]);
  } catch (error) {
    message.value = apiErrorMessage(error);
  }
}

async function removeInterface(interfaceId: string) {
  message.value = "";
  try {
    await $fetch(`/api/backend/interfaces/${interfaceId}`, { method: "DELETE" });
    await Promise.all([refreshInterfaces(), refreshDevice()]);
  } catch (error) {
    message.value = apiErrorMessage(error);
  }
}
</script>

<template>
  <AppBreadcrumb
    :items="[
      { label: 'Inventaire', to: '/inventory' },
      { label: device?.hostname ?? 'Équipement' },
    ]"
  />
  <header class="page-head">
    <div>
      <h1>{{ device?.hostname }}</h1>
      <p class="lede">
        {{ device ? roleLabels[device.role] : "" }}
        <span v-if="device" class="pill" :class="device.status">{{ statusLabels[device.status] }}</span>
      </p>
      <p v-if="device?.role === 'SWITCH'" class="lede">
        <NuxtLink class="row-link" :to="`/switches/${device.id}`">VLAN et ports</NuxtLink>
      </p>
    </div>
    <button v-if="canDelete" class="danger" type="button" @click="removeDevice">Retirer l'équipement</button>
  </header>
  <p v-if="message" class="banner">{{ message }}</p>

  <div class="grid">
    <form class="panel" @submit.prevent="saveDevice">
      <h2>Fiche</h2>
      <label>
        Rôle
        <select v-model="form.role" :disabled="!canWrite">
          <option v-for="(label, role) in roleLabels" :key="role" :value="role">{{ label }}</option>
        </select>
      </label>
      <label>Nom d'hôte <input v-model="form.hostname" :disabled="!canWrite" required /></label>
      <label>IP de management <input v-model="form.managementIp" :disabled="!canWrite" /></label>
      <label>Constructeur <input v-model="form.vendor" :disabled="!canWrite" /></label>
      <label>Modèle <input v-model="form.model" :disabled="!canWrite" /></label>
      <label>OS <input v-model="form.os" :disabled="!canWrite" /></label>
      <label>Version <input v-model="form.osVersion" :disabled="!canWrite" /></label>
      <label>Numéro de série <input v-model="form.serialNumber" :disabled="!canWrite" /></label>
      <label>
        Statut
        <select v-model="form.status" :disabled="!canWrite">
          <option v-for="(label, status) in statusLabels" :key="status" :value="status">{{ label }}</option>
        </select>
      </label>
      <label>Description <input v-model="form.description" :disabled="!canWrite" /></label>
      <LocationFields
        v-if="organizationId"
        :organization-id="organizationId"
        :disabled="!canWrite"
        v-model:site-id="form.siteId"
        v-model:building-id="form.buildingId"
        v-model:room-id="form.roomId"
        v-model:rack-id="form.rackId"
      />
      <button v-if="canWrite" class="primary" type="submit">Enregistrer</button>
    </form>

    <div class="stack">
      <section class="panel">
        <h2>Interfaces</h2>
        <label>Recherche <input v-model="interfaceQuery" placeholder="Nom, IP, MAC" /></label>
        <table v-if="interfaces?.data.length">
          <thead>
            <tr>
              <th>Nom</th>
              <th>IP</th>
              <th>MAC</th>
              <th>Vitesse</th>
              <th>Duplex</th>
              <th>Statut</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in interfaces.data" :key="item.id">
              <td class="mono">{{ item.name }}</td>
              <td class="mono">{{ item.ipAddress ?? "—" }}</td>
              <td class="mono">{{ item.macAddress ?? "—" }}</td>
              <td>{{ item.speedMbps ? `${item.speedMbps} Mbit/s` : "—" }}</td>
              <td>{{ item.duplex ? duplexLabels[item.duplex] : "—" }}</td>
              <td><span class="pill" :class="item.status">{{ interfaceStatusLabels[item.status] }}</span></td>
              <td><button v-if="canDelete" class="danger" type="button" @click="removeInterface(item.id)">Retirer</button></td>
            </tr>
          </tbody>
        </table>
        <p v-else class="empty">Aucune interface.</p>
      </section>

      <form v-if="canWrite" class="panel" @submit.prevent="createInterface">
        <h2>Nouvelle interface</h2>
        <label>Nom <input v-model="iface.name" required placeholder="Gi0/0" /></label>
        <label>IP <input v-model="iface.ipAddress" /></label>
        <label>MAC <input v-model="iface.macAddress" placeholder="aa:bb:cc:dd:ee:ff" /></label>
        <label>Vitesse (Mbit/s) <input v-model.number="iface.speedMbps" type="number" min="1" /></label>
        <label>
          Duplex
          <select v-model="iface.duplex">
            <option value="">Non précisé</option>
            <option v-for="(label, mode) in duplexLabels" :key="mode" :value="mode">{{ label }}</option>
          </select>
        </label>
        <label>
          Statut
          <select v-model="iface.status">
            <option v-for="(label, status) in interfaceStatusLabels" :key="status" :value="status">{{ label }}</option>
          </select>
        </label>
        <label>Description <input v-model="iface.description" /></label>
        <button class="primary" type="submit">Ajouter</button>
      </form>
    </div>
  </div>
</template>
