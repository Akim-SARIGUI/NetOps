<script setup lang="ts">
import type { AuditEvent, ListResponse, Organization } from "~/types/api";

definePageMeta({ layout: "console", middleware: "auth" });

const session = useSession();
const requestFetch = useRequestFetch();
const allowed = computed(() => canAudit(session.value));
const { data: organizations } = await useFetch<ListResponse<Organization>>("/api/backend/organizations");
const organizationId = ref(organizations.value?.data[0]?.id ?? "");

const { data: events } = await useAsyncData(
  "audit-events",
  () => {
    if (!allowed.value || !organizationId.value) return { data: [] as AuditEvent[] };
    return requestFetch<ListResponse<AuditEvent>>(
      `/api/backend/organizations/${organizationId.value}/audit-events`,
    );
  },
  { watch: [organizationId] },
);
</script>

<template>
  <header class="page-head">
    <div>
      <h1>Journal</h1>
      <p class="lede">Événements d'audit de l'organisation, en ajout seulement.</p>
    </div>
  </header>

  <p v-if="!allowed" class="banner">Votre rôle ne permet pas de consulter le journal.</p>

  <div v-else class="stack">
    <label>
      Organisation
      <select v-model="organizationId">
        <option v-for="organization in organizations?.data ?? []" :key="organization.id" :value="organization.id">
          {{ organization.name }}
        </option>
      </select>
    </label>
    <section class="panel">
      <table v-if="events?.data.length">
        <thead>
          <tr>
            <th>Quand</th>
            <th>Acteur</th>
            <th>Action</th>
            <th>Ressource</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="event in events.data" :key="event.id">
            <td>{{ new Date(event.createdAt).toLocaleString("fr-FR") }}</td>
            <td>{{ event.actor?.name ?? "système" }}</td>
            <td class="mono">{{ event.action }}</td>
            <td class="mono">{{ event.resourceType }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else class="empty">Aucun événement.</p>
    </section>
  </div>
</template>
