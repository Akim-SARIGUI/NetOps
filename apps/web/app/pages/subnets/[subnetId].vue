<script setup lang="ts">
import type { Device, ListResponse, NetworkInterface, SubnetDetail } from "~/types/api";

definePageMeta({ layout: "console", middleware: "auth" });

const route = useRoute();
const session = useSession();
const subnetId = computed(() => String(route.params.subnetId));
const { data: subnet, refresh } = await useFetch<SubnetDetail>(() => `/api/backend/subnets/${subnetId.value}`);
const organizationId = computed(() => subnet.value?.organizationId ?? "");
const canWrite = computed(() => can(session.value, organizationId.value, "inventory:write"));
const canDelete = computed(() => can(session.value, organizationId.value, "inventory:delete"));

const { data: devices } = await useFetch<ListResponse<Device>>(
  () => (organizationId.value ? `/api/backend/organizations/${organizationId.value}/devices` : null),
  { watch: [organizationId] },
);
const deviceId = ref("");
const { data: interfaces } = await useFetch<ListResponse<NetworkInterface>>(
  () => (deviceId.value ? `/api/backend/devices/${deviceId.value}/interfaces` : null),
  { watch: [deviceId] },
);

const message = ref("");
const allocation = reactive({ interfaceId: "", address: "", description: "" });
const reservation = reactive({ address: "", description: "" });

const roleLabels: Record<string, string> = { GATEWAY: "Passerelle", ALLOCATED: "Allouée", RESERVED: "Réservée" };

function percent(value: number) {
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(value);
}

async function run(action: () => Promise<void>) {
  message.value = "";
  try {
    await action();
    await refresh();
  } catch (error) {
    message.value = apiErrorMessage(error);
  }
}

function allocate() {
  return run(async () => {
    await $fetch(`/api/backend/subnets/${subnetId.value}/addresses`, {
      method: "POST",
      body: {
        role: "ALLOCATED",
        interfaceId: allocation.interfaceId,
        address: allocation.address || undefined,
        description: allocation.description || undefined,
      },
    });
    allocation.address = "";
    allocation.description = "";
  });
}

function reserve() {
  return run(async () => {
    await $fetch(`/api/backend/subnets/${subnetId.value}/addresses`, {
      method: "POST",
      body: { role: "RESERVED", address: reservation.address || undefined, description: reservation.description },
    });
    reservation.address = "";
    reservation.description = "";
  });
}

function removeAddress(id: string) {
  return run(async () => {
    await $fetch(`/api/backend/addresses/${id}`, { method: "DELETE" });
  });
}

function removeSubnet() {
  return run(async () => {
    await $fetch(`/api/backend/subnets/${subnetId.value}`, { method: "DELETE" });
    await navigateTo("/ipam");
  });
}
</script>

<template>
  <AppBreadcrumb :items="[{ label: 'Adressage', to: '/ipam' }, { label: subnet?.name ?? 'Sous-réseau' }]" />
  <header class="page-head">
    <div>
      <h1>{{ subnet?.name }}</h1>
      <p class="lede">
        <NuxtLink v-if="subnet" class="row-link" :to="`/vlans/${subnet.vlan.id}`">VLAN {{ subnet.vlan.vid }} · {{ subnet.vlan.name }}</NuxtLink>
        <span class="mono">{{ subnet?.cidr }}</span>
      </p>
    </div>
    <button v-if="canDelete" class="danger" type="button" @click="removeSubnet">Retirer le sous-réseau</button>
  </header>
  <p v-if="message" class="banner">{{ message }}</p>
  <section v-if="subnet?.issues.length" class="panel" style="margin-bottom: 16px">
    <h2>Incohérences</h2>
    <ul>
      <li v-for="issue in subnet.issues" :key="issue.code + issue.message">{{ issue.message }}</li>
    </ul>
  </section>

  <section class="stats">
    <article class="stat"><span>Réseau</span><strong class="mono">{{ subnet?.stats.network }}</strong></article>
    <article class="stat"><span>Masque</span><strong class="mono">{{ subnet?.stats.netmask }}</strong></article>
    <article class="stat"><span>Préfixe</span><strong>/{{ subnet?.stats.prefix }}</strong></article>
    <article class="stat"><span>Première</span><strong class="mono">{{ subnet?.stats.firstUsable ?? "—" }}</strong></article>
    <article class="stat"><span>Dernière</span><strong class="mono">{{ subnet?.stats.lastUsable ?? "—" }}</strong></article>
    <article class="stat"><span>Broadcast</span><strong class="mono">{{ subnet?.stats.broadcast ?? "—" }}</strong></article>
    <article class="stat"><span>Total</span><strong>{{ subnet?.stats.total }}</strong></article>
    <article class="stat"><span>Utilisables</span><strong>{{ subnet?.stats.usable }}</strong></article>
    <article class="stat"><span>Utilisées</span><strong>{{ subnet?.stats.used }}</strong></article>
    <article class="stat"><span>Disponibles</span><strong>{{ subnet?.stats.available }}</strong></article>
  </section>

  <section class="panel" style="margin-bottom: 16px">
    <h2>Occupation · {{ percent(subnet?.stats.utilization ?? 0) }} %</h2>
    <div class="util" style="margin-bottom: 14px">
      <div class="util-bar"><span :style="{ width: `${Math.min(subnet?.stats.utilization ?? 0, 100)}%` }" /></div>
    </div>
    <template v-if="subnet?.grid">
      <p class="legend">
        <span><i class="cell" /> Libre</span>
        <span><i class="cell allocated" /> Allouée</span>
        <span><i class="cell reserved" /> Réservée</span>
        <span><i class="cell gateway" /> Passerelle</span>
        <span><i class="cell network" /> Réseau / broadcast</span>
      </p>
      <div class="util-grid">
        <span v-for="cell in subnet.grid" :key="cell.address" class="cell" :class="cell.kind" :title="cell.address" />
      </div>
    </template>
    <p v-else class="hint">Le préfixe est trop grand pour une grille adresse par adresse. L'occupation reste calculée.</p>
  </section>

  <div class="grid">
    <section class="panel">
      <h2>Adresses</h2>
      <p class="hint">Passerelle {{ subnet?.gateway?.address ?? "—" }}<span v-if="subnet?.gateway?.interface"> · {{ subnet.gateway.interface.device.hostname }} {{ subnet.gateway.interface.name }}</span></p>
      <table v-if="subnet?.addresses.length">
        <thead>
          <tr>
            <th>Adresse</th>
            <th>Rôle</th>
            <th>Interface</th>
            <th>Description</th>
            <th v-if="canDelete"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="address in subnet.addresses" :key="address.id">
            <td class="mono">{{ address.address }}</td>
            <td>{{ roleLabels[address.role] }}</td>
            <td>{{ address.interface ? `${address.interface.device.hostname} ${address.interface.name}` : "—" }}</td>
            <td>{{ address.description ?? "—" }}</td>
            <td v-if="canDelete">
              <button v-if="address.role !== 'GATEWAY'" class="danger" type="button" @click="removeAddress(address.id)">Retirer</button>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
    <div v-if="canWrite" class="stack">
      <form class="panel" @submit.prevent="allocate">
        <h2>Allouer une adresse</h2>
        <label>
          Équipement
          <select v-model="deviceId">
            <option value="">Choisir</option>
            <option v-for="item in devices?.data ?? []" :key="item.id" :value="item.id">{{ item.hostname }}</option>
          </select>
        </label>
        <label>
          Interface
          <select v-model="allocation.interfaceId" required>
            <option value="" disabled>Choisir</option>
            <option v-for="item in interfaces?.data ?? []" :key="item.id" :value="item.id">{{ item.name }}</option>
          </select>
        </label>
        <label>Adresse <input v-model="allocation.address" placeholder="vide = prochaine libre" /></label>
        <label>Description <input v-model="allocation.description" /></label>
        <button class="primary" type="submit">Allouer</button>
      </form>
      <form class="panel" @submit.prevent="reserve">
        <h2>Réserver une adresse</h2>
        <label>Adresse <input v-model="reservation.address" placeholder="vide = prochaine libre" /></label>
        <label>Description <input v-model="reservation.description" required /></label>
        <button class="primary" type="submit">Réserver</button>
      </form>
    </div>
  </div>
</template>
