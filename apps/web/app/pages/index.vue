<script setup lang="ts">
import type { ListResponse, Organization } from "~/types/api";

definePageMeta({ layout: "console", middleware: "auth" });

const session = useSession();
const message = ref("");
const form = reactive({ name: "", slug: "" });

const { data, refresh } = await useFetch<ListResponse<Organization>>("/api/backend/organizations");

async function createOrganization() {
  message.value = "";
  try {
    await $fetch("/api/backend/organizations", {
      method: "POST",
      body: { name: form.name, slug: form.slug || undefined },
    });
    form.name = "";
    form.slug = "";
    await refresh();
  } catch (error) {
    message.value = apiErrorMessage(error);
  }
}
</script>

<template>
  <header class="page-head">
    <div>
      <h1>Organisations</h1>
      <p class="lede">Périmètre d'isolation des sites et des accès.</p>
    </div>
  </header>

  <div class="grid">
    <section class="panel">
      <table v-if="data?.data.length">
        <thead>
          <tr>
            <th>Nom</th>
            <th>Slug</th>
            <th>Sites</th>
            <th>Membres</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="organization in data.data" :key="organization.id">
            <td><NuxtLink class="row-link" :to="`/organizations/${organization.id}`">{{ organization.name }}</NuxtLink></td>
            <td class="mono">{{ organization.slug }}</td>
            <td>{{ organization.counts?.sites ?? 0 }}</td>
            <td>{{ organization.counts?.members ?? 0 }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else class="empty">Aucune organisation visible.</p>
    </section>

    <form v-if="session?.user.isSuperAdmin" class="panel" @submit.prevent="createOrganization">
      <h2>Nouvelle organisation</h2>
      <p v-if="message" class="banner">{{ message }}</p>
      <label>Nom <input v-model="form.name" required minlength="2" /></label>
      <label>Slug <input v-model="form.slug" placeholder="optionnel" /></label>
      <button class="primary" type="submit">Créer</button>
    </form>
  </div>
</template>
