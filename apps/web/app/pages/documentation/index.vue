<script setup lang="ts">
import type { DocumentationExport, DocumentationOverview, ListResponse, Organization, Site } from "~/types/api";

definePageMeta({ layout: "console", middleware: "auth" });

const session = useSession();
const { data: organizations } = await useFetch<ListResponse<Organization>>("/api/backend/organizations");
const organizationId = ref(organizations.value?.data[0]?.id ?? "");
const siteId = ref("");
const message = ref("");
const canRead = computed(() => can(session.value, organizationId.value, "inventory:read"));

const query = computed(() => {
  if (!organizationId.value) return null;
  const params = new URLSearchParams();
  if (siteId.value) params.set("siteId", siteId.value);
  const suffix = params.toString();
  return `/api/backend/organizations/${organizationId.value}/documentation${suffix ? `?${suffix}` : ""}`;
});

const { data: documentation, refresh } = await useFetch<DocumentationOverview>(() => query.value, { watch: [query] });
const { data: sites } = await useFetch<ListResponse<Site>>(
  () => (organizationId.value ? `/api/backend/organizations/${organizationId.value}/sites` : null),
  { watch: [organizationId] },
);

async function download(format: "JSON" | "CSV" | "PDF") {
  message.value = "";
  try {
    const params = new URLSearchParams({ format });
    if (siteId.value) params.set("siteId", siteId.value);
    const exported = await $fetch<DocumentationExport>(
      `/api/backend/organizations/${organizationId.value}/documentation/export?${params.toString()}`,
    );
    const binary = exported.encoding === "base64" ? Uint8Array.from(atob(exported.content), (char) => char.charCodeAt(0)) : new TextEncoder().encode(exported.content);
    const blob = new Blob([binary], { type: exported.mediaType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = exported.filename;
    anchor.click();
    URL.revokeObjectURL(url);
    await refresh();
  } catch (error) {
    message.value = apiErrorMessage(error);
  }
}
</script>

<template>
  <header class="page-head">
    <div>
      <h1>Documentation</h1>
      <p class="lede">{{ documentation?.notice }}</p>
    </div>
  </header>
  <p v-if="message" class="banner">{{ message }}</p>
  <p v-if="documentation">Générée le {{ documentation.generatedAt }} · {{ documentation.organization.name }}</p>

  <section class="panel" style="margin: 16px 0">
    <h2>Périmètre</h2>
    <label>Site
      <select v-model="siteId">
        <option value="">Tous les sites</option>
        <option v-for="site in sites?.data ?? []" :key="site.id" :value="site.id">{{ site.name }} · {{ site.environment }}</option>
      </select>
    </label>
    <div v-if="canRead" class="grid" style="margin-top: 12px">
      <button type="button" @click="download('JSON')">Exporter JSON</button>
      <button type="button" @click="download('CSV')">Exporter CSV</button>
      <button type="button" @click="download('PDF')">Exporter PDF</button>
    </div>
  </section>

  <section class="panel">
    <h2>Relations entre modules</h2>
    <ul>
      <li v-for="relation in documentation?.relations ?? []" :key="`${relation.from}-${relation.to}`">
        {{ relation.from }} → {{ relation.to }} : {{ relation.rule }}
      </li>
    </ul>
  </section>

  <section v-for="section in documentation?.sections ?? []" :key="section.id" class="panel" style="margin-top: 16px">
    <h2>{{ section.title }}</h2>
    <p>{{ section.description }}</p>
    <p>{{ section.rowCount }} ligne(s)</p>
    <table v-if="section.preview.length">
      <thead>
        <tr>
          <th v-for="column in section.columns" :key="column">{{ column }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(row, index) in section.preview" :key="index">
          <td v-for="column in section.columns" :key="column">{{ row[column] }}</td>
        </tr>
      </tbody>
    </table>
    <p v-else class="empty">Aucune donnée.</p>
  </section>
</template>
