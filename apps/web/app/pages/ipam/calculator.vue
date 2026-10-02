<script setup lang="ts">
import type { ListResponse, Organization, VlsmPlan } from "~/types/api";

definePageMeta({ layout: "console", middleware: "auth" });

const { data: organizations } = await useFetch<ListResponse<Organization>>("/api/backend/organizations");
const organizationId = ref(organizations.value?.data[0]?.id ?? "");
const cidr = ref("10.2.0.0/16");
const requests = ref([
  { name: "Utilisateurs", hosts: 100 },
  { name: "Voix", hosts: 20 },
  { name: "Serveurs", hosts: 10 },
]);
const message = ref("");
const plan = ref<VlsmPlan | null>(null);

function addRow() {
  requests.value.push({ name: "", hosts: 10 });
}

async function calculate() {
  message.value = "";
  plan.value = null;
  try {
    plan.value = await $fetch<VlsmPlan>(`/api/backend/organizations/${organizationId.value}/ipam/plan`, {
      method: "POST",
      body: {
        cidr: cidr.value,
        requests: requests.value.map((request) => ({ name: request.name, hosts: Number(request.hosts) })),
      },
    });
  } catch (error) {
    message.value = apiErrorMessage(error);
  }
}
</script>

<template>
  <AppBreadcrumb :items="[{ label: 'Adressage', to: '/ipam' }, { label: 'Calculateur' }]" />
  <header class="page-head">
    <div>
      <h1>Calculateur CIDR / VLSM</h1>
      <p class="lede">Découpe un préfixe parent selon le nombre d'hôtes, sans rien enregistrer.</p>
    </div>
  </header>
  <p v-if="message" class="banner">{{ message }}</p>
  <div class="grid">
    <form class="panel" @submit.prevent="calculate">
      <label>Préfixe parent <input v-model="cidr" required /></label>
      <div v-for="(request, index) in requests" :key="index" class="actions">
        <label>Nom <input v-model="request.name" required /></label>
        <label>Hôtes <input v-model.number="request.hosts" type="number" min="1" required /></label>
      </div>
      <div class="actions">
        <button class="danger" type="button" @click="addRow">Ajouter une demande</button>
        <button class="primary" type="submit">Calculer</button>
      </div>
    </form>
    <section v-if="plan" class="panel">
      <h2>{{ plan.feasible ? "Découpe possible" : "Allocation impossible" }}</h2>
      <p v-if="plan.message" class="banner">{{ plan.message }}</p>
      <table v-if="plan.subnets.length">
        <thead>
          <tr>
            <th>Nom</th>
            <th>CIDR</th>
            <th>Masque</th>
            <th>Première</th>
            <th>Dernière</th>
            <th>Utilisables</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="subnet in plan.subnets" :key="subnet.cidr">
            <td>{{ subnet.name }}</td>
            <td class="mono">{{ subnet.cidr }}</td>
            <td class="mono">{{ subnet.netmask }}</td>
            <td class="mono">{{ subnet.firstUsable }}</td>
            <td class="mono">{{ subnet.lastUsable }}</td>
            <td class="mono">{{ subnet.usable }}</td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>
