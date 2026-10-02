<script setup lang="ts">
import type { Device, ListResponse, Rack } from "~/types/api";

definePageMeta({ layout: "console", middleware: "auth" });

const route = useRoute();
const rackId = computed(() => String(route.params.rackId));
const { data: rack } = await useFetch<Rack>(() => `/api/backend/racks/${rackId.value}`);
const { data: devices } = await useFetch<ListResponse<Device>>(() => `/api/backend/racks/${rackId.value}/devices`);
</script>

<template>
  <AppBreadcrumb
    :items="[
      { label: rack?.organization?.name ?? 'Organisation', to: rack?.site ? `/organizations/${rack.site.organizationId}` : undefined },
      { label: rack?.site?.name ?? 'Site', to: rack?.site ? `/sites/${rack.site.id}` : undefined },
      { label: rack?.building?.name ?? 'Bâtiment', to: rack?.building ? `/buildings/${rack.building.id}` : undefined },
      { label: rack?.room?.name ?? 'Salle', to: rack?.room ? `/rooms/${rack.room.id}` : undefined },
      { label: rack?.name ?? 'Baie' },
    ]"
  />
  <header class="page-head">
    <div>
      <h1>{{ rack?.name }}</h1>
      <p class="lede"><span class="mono">{{ rack?.code }}</span> · {{ rack?.heightU }} U</p>
    </div>
  </header>
  <section class="panel">
    <h2>Équipements</h2>
    <table v-if="devices?.data.length">
      <thead>
        <tr>
          <th>Nom</th>
          <th>Rôle</th>
          <th>IP</th>
          <th>Statut</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="device in devices.data" :key="device.id">
          <td><NuxtLink class="row-link" :to="`/devices/${device.id}`">{{ device.hostname }}</NuxtLink></td>
          <td>{{ roleLabels[device.role] }}</td>
          <td class="mono">{{ device.managementIp ?? "—" }}</td>
          <td><span class="pill" :class="device.status">{{ statusLabels[device.status] }}</span></td>
        </tr>
      </tbody>
    </table>
    <p v-else class="empty">Aucun équipement dans cette baie.</p>
  </section>
</template>
