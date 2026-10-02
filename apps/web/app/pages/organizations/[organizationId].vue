<script setup lang="ts">
import type { ListResponse, Member, Organization, Site } from "~/types/api";

definePageMeta({ layout: "console", middleware: "auth" });

const route = useRoute();
const session = useSession();
const organizationId = computed(() => String(route.params.organizationId));
const message = ref("");
const form = reactive({ name: "", code: "", environment: "PRODUCTION", address: "" });

const canWrite = computed(() => can(session.value, organizationId.value, "hierarchy:write"));
const canDelete = computed(() => can(session.value, organizationId.value, "hierarchy:delete"));
const canReadMembers = computed(() => can(session.value, organizationId.value, "members:read"));
const canWriteMembers = computed(() => can(session.value, organizationId.value, "members:write"));

const { data: organization } = await useFetch<Organization>(() => `/api/backend/organizations/${organizationId.value}`);
const { data: sites, refresh: refreshSites } = await useFetch<ListResponse<Site>>(
  () => `/api/backend/organizations/${organizationId.value}/sites`,
);
const { data: members, refresh: refreshMembers } = await useFetch<ListResponse<Member>>(
  () => `/api/backend/organizations/${organizationId.value}/members`,
  { immediate: canReadMembers.value },
);

async function createSite() {
  message.value = "";
  try {
    await $fetch(`/api/backend/organizations/${organizationId.value}/sites`, {
      method: "POST",
      body: {
        name: form.name,
        code: form.code,
        environment: form.environment,
        address: form.address || null,
      },
    });
    form.name = "";
    form.code = "";
    form.address = "";
    await refreshSites();
  } catch (error) {
    message.value = apiErrorMessage(error);
  }
}

async function removeSite(siteId: string) {
  message.value = "";
  try {
    await $fetch(`/api/backend/sites/${siteId}`, { method: "DELETE" });
    await refreshSites();
  } catch (error) {
    message.value = apiErrorMessage(error);
  }
}

async function changeRole(member: Member, role: string) {
  message.value = "";
  try {
    await $fetch(`/api/backend/organizations/${organizationId.value}/members/${member.user.id}`, {
      method: "PATCH",
      body: { role },
    });
    await refreshMembers();
  } catch (error) {
    message.value = apiErrorMessage(error);
  }
}

function onRoleChange(member: Member, event: Event) {
  const target = event.target;
  if (!(target instanceof HTMLSelectElement)) return;
  return changeRole(member, target.value);
}
</script>

<template>
  <AppBreadcrumb :items="[{ label: organization?.name ?? 'Organisation' }]" />
  <header class="page-head">
    <div>
      <h1>{{ organization?.name }}</h1>
      <p class="lede"><span class="mono">{{ organization?.slug }}</span></p>
    </div>
  </header>
  <p v-if="message" class="banner">{{ message }}</p>

  <div class="grid">
    <div class="stack">
      <section class="panel">
        <h2>Sites</h2>
        <table v-if="sites?.data.length">
          <thead>
            <tr>
              <th>Nom</th>
              <th>Code</th>
              <th>Environnement</th>
              <th>Bâtiments</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="site in sites.data" :key="site.id">
              <td><NuxtLink class="row-link" :to="`/sites/${site.id}`">{{ site.name }}</NuxtLink></td>
              <td class="mono">{{ site.code }}</td>
              <td><span class="pill" :class="site.environment">{{ site.environment }}</span></td>
              <td>{{ site.counts?.buildings ?? 0 }}</td>
              <td>
                <button v-if="canDelete" class="danger" type="button" @click="removeSite(site.id)">Retirer</button>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-else class="empty">Aucun site.</p>
      </section>

      <section v-if="canReadMembers" class="panel">
        <h2>Membres</h2>
        <table v-if="members?.data.length">
          <thead>
            <tr>
              <th>Nom</th>
              <th>E-mail</th>
              <th>Rôle</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="member in members.data" :key="member.user.id">
              <td>{{ member.user.name }}</td>
              <td class="mono">{{ member.user.email }}</td>
              <td>
                <select
                  v-if="canWriteMembers && member.user.id !== session?.user.id"
                  :value="member.role"
                  @change="onRoleChange(member, $event)"
                >
                  <option>NETWORK_ADMIN</option>
                  <option>NETWORK_OPERATOR</option>
                  <option>AUDITOR</option>
                  <option>VIEWER</option>
                </select>
                <span v-else class="mono">{{ member.role }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>

    <form v-if="canWrite" class="panel" @submit.prevent="createSite">
      <h2>Nouveau site</h2>
      <label>Nom <input v-model="form.name" required minlength="2" /></label>
      <label>Code <input v-model="form.code" required /></label>
      <label>
        Environnement
        <select v-model="form.environment">
          <option value="PRODUCTION">Production</option>
          <option value="STAGING">Préproduction</option>
          <option value="DEV">Développement</option>
          <option value="LAB">Laboratoire</option>
        </select>
      </label>
      <label>Adresse <input v-model="form.address" /></label>
      <button class="primary" type="submit">Ajouter</button>
    </form>
  </div>
</template>
