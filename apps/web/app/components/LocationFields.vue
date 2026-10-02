<script setup lang="ts">
import type { Building, ListResponse, Rack, Room, Site } from "~/types/api";

const siteId = defineModel<string>("siteId", { required: true });
const buildingId = defineModel<string | null>("buildingId", { required: true });
const roomId = defineModel<string | null>("roomId", { required: true });
const rackId = defineModel<string | null>("rackId", { required: true });

const props = defineProps<{ organizationId: string; disabled?: boolean }>();

const { data: sites } = await useFetch<ListResponse<Site>>(
  () => `/api/backend/organizations/${props.organizationId}/sites`,
);
const { data: buildings } = await useFetch<ListResponse<Building>>(
  () => (siteId.value ? `/api/backend/sites/${siteId.value}/buildings` : null),
  { watch: [siteId] },
);
const { data: rooms } = await useFetch<ListResponse<Room>>(
  () => (buildingId.value ? `/api/backend/buildings/${buildingId.value}/rooms` : null),
  { watch: [buildingId] },
);
const { data: racks } = await useFetch<ListResponse<Rack>>(
  () => (roomId.value ? `/api/backend/rooms/${roomId.value}/racks` : null),
  { watch: [roomId] },
);

watch(siteId, (_value, previous) => {
  if (!previous) return;
  buildingId.value = null;
  roomId.value = null;
  rackId.value = null;
});
watch(buildingId, (_value, previous) => {
  if (previous === undefined) return;
  roomId.value = null;
  rackId.value = null;
});
watch(roomId, (_value, previous) => {
  if (previous === undefined) return;
  rackId.value = null;
});
</script>

<template>
  <label>
    Site
    <select v-model="siteId" required :disabled="disabled">
      <option disabled value="">Choisir un site</option>
      <option v-for="site in sites?.data ?? []" :key="site.id" :value="site.id">{{ site.name }}</option>
    </select>
  </label>
  <label>
    Bâtiment
    <select v-model="buildingId" :disabled="disabled || !siteId">
      <option :value="null">Aucun</option>
      <option v-for="building in buildings?.data ?? []" :key="building.id" :value="building.id">{{ building.name }}</option>
    </select>
  </label>
  <label>
    Salle
    <select v-model="roomId" :disabled="disabled || !buildingId">
      <option :value="null">Aucune</option>
      <option v-for="room in rooms?.data ?? []" :key="room.id" :value="room.id">{{ room.name }}</option>
    </select>
  </label>
  <label>
    Baie
    <select v-model="rackId" :disabled="disabled || !roomId">
      <option :value="null">Aucune</option>
      <option v-for="rack in racks?.data ?? []" :key="rack.id" :value="rack.id">{{ rack.name }}</option>
    </select>
  </label>
</template>
