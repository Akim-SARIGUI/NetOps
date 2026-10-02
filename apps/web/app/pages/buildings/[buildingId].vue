<script setup lang="ts">
import type { Building, ListResponse, Room } from "~/types/api";

definePageMeta({ layout: "console", middleware: "auth" });

const route = useRoute();
const session = useSession();
const buildingId = computed(() => String(route.params.buildingId));
const message = ref("");
const form = reactive({ name: "", code: "" });

const { data: building } = await useFetch<Building>(() => `/api/backend/buildings/${buildingId.value}`);
const organizationId = computed(() => building.value?.site?.organizationId ?? "");
const canWrite = computed(() => can(session.value, organizationId.value, "hierarchy:write"));
const canDelete = computed(() => can(session.value, organizationId.value, "hierarchy:delete"));
const { data: rooms, refresh } = await useFetch<ListResponse<Room>>(
  () => `/api/backend/buildings/${buildingId.value}/rooms`,
);

async function createRoom() {
  message.value = "";
  try {
    await $fetch(`/api/backend/buildings/${buildingId.value}/rooms`, { method: "POST", body: form });
    form.name = "";
    form.code = "";
    await refresh();
  } catch (error) {
    message.value = apiErrorMessage(error);
  }
}

async function removeRoom(roomId: string) {
  message.value = "";
  try {
    await $fetch(`/api/backend/rooms/${roomId}`, { method: "DELETE" });
    await refresh();
  } catch (error) {
    message.value = apiErrorMessage(error);
  }
}
</script>

<template>
  <AppBreadcrumb
    :items="[
      { label: building?.organization?.name ?? 'Organisation', to: building?.site ? `/organizations/${building.site.organizationId}` : undefined },
      { label: building?.site?.name ?? 'Site', to: building?.site ? `/sites/${building.site.id}` : undefined },
      { label: building?.name ?? 'Bâtiment' },
    ]"
  />
  <header class="page-head">
    <div>
      <h1>{{ building?.name }}</h1>
      <p class="lede"><span class="mono">{{ building?.code }}</span></p>
    </div>
  </header>
  <p v-if="message" class="banner">{{ message }}</p>
  <div class="grid">
    <section class="panel">
      <h2>Salles</h2>
      <table v-if="rooms?.data.length">
        <thead>
          <tr><th>Nom</th><th>Code</th><th>Baies</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="room in rooms.data" :key="room.id">
            <td><NuxtLink class="row-link" :to="`/rooms/${room.id}`">{{ room.name }}</NuxtLink></td>
            <td class="mono">{{ room.code }}</td>
            <td>{{ room.counts?.racks ?? 0 }}</td>
            <td><button v-if="canDelete" class="danger" type="button" @click="removeRoom(room.id)">Retirer</button></td>
          </tr>
        </tbody>
      </table>
      <p v-else class="empty">Aucune salle.</p>
    </section>
    <form v-if="canWrite" class="panel" @submit.prevent="createRoom">
      <h2>Nouvelle salle</h2>
      <label>Nom <input v-model="form.name" required minlength="2" /></label>
      <label>Code <input v-model="form.code" required /></label>
      <button class="primary" type="submit">Ajouter</button>
    </form>
  </div>
</template>
