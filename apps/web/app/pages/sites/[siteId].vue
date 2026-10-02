<script setup lang="ts">
import type { Building, ListResponse, Site } from "~/types/api";

definePageMeta({ layout: "console", middleware: "auth" });

const route = useRoute();
const session = useSession();
const siteId = computed(() => String(route.params.siteId));
const message = ref("");
const form = reactive({ name: "", code: "" });

const { data: site } = await useFetch<Site>(() => `/api/backend/sites/${siteId.value}`);
const organizationId = computed(() => site.value?.organizationId ?? "");
const canWrite = computed(() => can(session.value, organizationId.value, "hierarchy:write"));
const canDelete = computed(() => can(session.value, organizationId.value, "hierarchy:delete"));

const { data: buildings, refresh } = await useFetch<ListResponse<Building>>(
  () => `/api/backend/sites/${siteId.value}/buildings`,
);

async function createBuilding() {
  message.value = "";
  try {
    await $fetch(`/api/backend/sites/${siteId.value}/buildings`, { method: "POST", body: form });
    form.name = "";
    form.code = "";
    await refresh();
  } catch (error) {
    message.value = apiErrorMessage(error);
  }
}

async function removeBuilding(buildingId: string) {
  message.value = "";
  try {
    await $fetch(`/api/backend/buildings/${buildingId}`, { method: "DELETE" });
    await refresh();
  } catch (error) {
    message.value = apiErrorMessage(error);
  }
}
</script>

<template>
  <AppBreadcrumb
    :items="[
      { label: site?.organization?.name ?? 'Organisation', to: site ? `/organizations/${site.organizationId}` : undefined },
      { label: site?.name ?? 'Site' },
    ]"
  />
  <header class="page-head">
    <div>
      <h1>{{ site?.name }}</h1>
      <p class="lede">
        <span class="mono">{{ site?.code }}</span>
        <span v-if="site" class="pill" :class="site.environment">{{ site.environment }}</span>
      </p>
    </div>
  </header>
  <p v-if="message" class="banner">{{ message }}</p>
  <div class="grid">
    <section class="panel">
      <h2>Bâtiments</h2>
      <table v-if="buildings?.data.length">
        <thead>
          <tr><th>Nom</th><th>Code</th><th>Salles</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="building in buildings.data" :key="building.id">
            <td><NuxtLink class="row-link" :to="`/buildings/${building.id}`">{{ building.name }}</NuxtLink></td>
            <td class="mono">{{ building.code }}</td>
            <td>{{ building.counts?.rooms ?? 0 }}</td>
            <td><button v-if="canDelete" class="danger" type="button" @click="removeBuilding(building.id)">Retirer</button></td>
          </tr>
        </tbody>
      </table>
      <p v-else class="empty">Aucun bâtiment.</p>
    </section>
    <form v-if="canWrite" class="panel" @submit.prevent="createBuilding">
      <h2>Nouveau bâtiment</h2>
      <label>Nom <input v-model="form.name" required minlength="2" /></label>
      <label>Code <input v-model="form.code" required /></label>
      <button class="primary" type="submit">Ajouter</button>
    </form>
  </div>
</template>
