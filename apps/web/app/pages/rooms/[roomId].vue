<script setup lang="ts">
import type { ListResponse, Rack, Room } from "~/types/api";

definePageMeta({ layout: "console", middleware: "auth" });

const route = useRoute();
const session = useSession();
const roomId = computed(() => String(route.params.roomId));
const message = ref("");
const form = reactive({ name: "", code: "", heightU: 42 });

const { data: room } = await useFetch<Room>(() => `/api/backend/rooms/${roomId.value}`);
const organizationId = computed(() => room.value?.site?.organizationId ?? "");
const canWrite = computed(() => can(session.value, organizationId.value, "hierarchy:write"));
const canDelete = computed(() => can(session.value, organizationId.value, "hierarchy:delete"));
const { data: racks, refresh } = await useFetch<ListResponse<Rack>>(() => `/api/backend/rooms/${roomId.value}/racks`);

async function createRack() {
  message.value = "";
  try {
    await $fetch(`/api/backend/rooms/${roomId.value}/racks`, {
      method: "POST",
      body: { name: form.name, code: form.code, heightU: Number(form.heightU) },
    });
    form.name = "";
    form.code = "";
    form.heightU = 42;
    await refresh();
  } catch (error) {
    message.value = apiErrorMessage(error);
  }
}

async function removeRack(rackId: string) {
  message.value = "";
  try {
    await $fetch(`/api/backend/racks/${rackId}`, { method: "DELETE" });
    await refresh();
  } catch (error) {
    message.value = apiErrorMessage(error);
  }
}
</script>

<template>
  <AppBreadcrumb
    :items="[
      { label: room?.organization?.name ?? 'Organisation', to: room?.site ? `/organizations/${room.site.organizationId}` : undefined },
      { label: room?.site?.name ?? 'Site', to: room?.site ? `/sites/${room.site.id}` : undefined },
      { label: room?.building?.name ?? 'Bâtiment', to: room?.building ? `/buildings/${room.building.id}` : undefined },
      { label: room?.name ?? 'Salle' },
    ]"
  />
  <header class="page-head">
    <div>
      <h1>{{ room?.name }}</h1>
      <p class="lede"><span class="mono">{{ room?.code }}</span></p>
    </div>
  </header>
  <p v-if="message" class="banner">{{ message }}</p>
  <div class="grid">
    <section class="panel">
      <h2>Baies</h2>
      <table v-if="racks?.data.length">
        <thead>
          <tr><th>Nom</th><th>Code</th><th>Hauteur</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="rack in racks.data" :key="rack.id">
            <td><NuxtLink class="row-link" :to="`/racks/${rack.id}`">{{ rack.name }}</NuxtLink></td>
            <td class="mono">{{ rack.code }}</td>
            <td>{{ rack.heightU }} U</td>
            <td><button v-if="canDelete" class="danger" type="button" @click="removeRack(rack.id)">Retirer</button></td>
          </tr>
        </tbody>
      </table>
      <p v-else class="empty">Aucune baie.</p>
    </section>
    <form v-if="canWrite" class="panel" @submit.prevent="createRack">
      <h2>Nouvelle baie</h2>
      <label>Nom <input v-model="form.name" required minlength="2" /></label>
      <label>Code <input v-model="form.code" required /></label>
      <label>Hauteur (U) <input v-model.number="form.heightU" type="number" min="1" max="58" required /></label>
      <button class="primary" type="submit">Ajouter</button>
    </form>
  </div>
</template>
