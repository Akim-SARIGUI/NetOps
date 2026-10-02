<script setup lang="ts">
import type { DhcpScopeDetail } from "~/types/api";

definePageMeta({ layout: "console", middleware: "auth" });

const route = useRoute();
const session = useSession();
const scopeId = computed(() => String(route.params.scopeId));
const { data: scope, refresh } = await useFetch<DhcpScopeDetail>(() => `/api/backend/dhcp/scopes/${scopeId.value}`);
const canWrite = computed(() => can(session.value, scope.value?.organizationId ?? "", "inventory:write"));
const message = ref("");
const pool = reactive({ start: "", end: "" });
const exclusion = reactive({ start: "", end: "", reason: "" });
const reservation = reactive({ address: "", macAddress: "", hostname: "" });
const simulation = reactive({ macAddress: "", hostname: "" });

function percent(value: number) {
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(value);
}

function leaseLabel(seconds: number) {
  if (seconds % 86400 === 0) return `${seconds / 86400} j`;
  if (seconds % 3600 === 0) return `${seconds / 3600} h`;
  return `${seconds} s`;
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

function post(path: string, body: unknown, reset: () => void) {
  return run(async () => {
    await $fetch(`/api/backend/dhcp/scopes/${scopeId.value}/${path}`, { method: "POST", body });
    reset();
  });
}
</script>

<template>
  <AppBreadcrumb :items="[{ label: 'DHCP', to: '/dhcp' }, { label: scope ? `VLAN ${scope.vlan.vid}` : 'Scope' }]" />
  <header class="page-head">
    <div>
      <h1>VLAN {{ scope?.vlan.vid }} · {{ scope?.subnet.cidr }}</h1>
      <p class="lede">Simulation locale. Le bail n'est pas demandé à un serveur DHCP réel. Durée {{ scope ? leaseLabel(scope.leaseSeconds) : "" }} · {{ scope?.server.name }}</p>
    </div>
  </header>
  <p v-if="message" class="banner">{{ message }}</p>
  <div class="metrics">
    <article class="metric"><span>Capacité</span><strong>{{ scope?.stats.capacity ?? "0" }}</strong></article>
    <article class="metric"><span>Utilisées</span><strong>{{ scope?.stats.used ?? "0" }}</strong></article>
    <article class="metric"><span>Disponibles</span><strong>{{ scope?.stats.available ?? "0" }}</strong></article>
    <article class="metric"><span>Utilisation</span><strong>{{ percent(scope?.stats.utilization ?? 0) }} %</strong></article>
  </div>
  <section v-if="scope?.issues.length" class="panel" style="margin-bottom: 16px">
    <h2>Alertes</h2>
    <ul>
      <li v-for="issue in scope.issues" :key="issue.code + issue.message">{{ issue.message }}</li>
    </ul>
  </section>
  <section class="panel">
    <p>Passerelle <span class="mono">{{ scope?.gateway }}</span> · DNS <span class="mono">{{ scope?.dnsServers.join(", ") || "—" }}</span> · Domaine {{ scope?.domain || "—" }}</p>
    <p v-if="scope?.relays.length">Relais <span v-for="relay in scope.relays" :key="relay.id" class="mono">{{ relay.helperAddress }} </span></p>
    <h2>Pools</h2>
    <ul v-if="scope?.pools.length">
      <li v-for="item in scope.pools" :key="item.id" class="mono">{{ item.start }} → {{ item.end }}</li>
    </ul>
    <p v-else class="empty">Aucun pool.</p>
    <h2>Exclusions</h2>
    <ul v-if="scope?.exclusions.length">
      <li v-for="item in scope.exclusions" :key="item.id"><span class="mono">{{ item.start }} → {{ item.end }}</span> <span v-if="item.reason">· {{ item.reason }}</span></li>
    </ul>
    <p v-else class="empty">Aucune exclusion.</p>
    <h2>Réservations</h2>
    <ul v-if="scope?.reservations.length">
      <li v-for="item in scope.reservations" :key="item.id"><span class="mono">{{ item.address }}</span> · {{ item.macAddress }} <span v-if="item.hostname">· {{ item.hostname }}</span></li>
    </ul>
    <p v-else class="empty">Aucune réservation.</p>
    <h2>Baux</h2>
    <ul v-if="scope?.leases.length">
      <li v-for="lease in scope.leases" :key="lease.id">
        <span class="mono">{{ lease.address }}</span> · {{ lease.macAddress }} · {{ lease.state }} · {{ lease.origin === "SIMULATION" ? "Simulation" : lease.origin }}
      </li>
    </ul>
    <p v-else class="empty">Aucun bail.</p>
  </section>
  <div v-if="canWrite" class="grid" style="margin-top: 16px">
    <form class="panel" @submit.prevent="post('pools', pool, () => { pool.start = ''; pool.end = ''; })">
      <h2>Ajouter un pool</h2>
      <label>Début <input v-model="pool.start" required /></label>
      <label>Fin <input v-model="pool.end" required /></label>
      <button class="primary" type="submit">Ajouter</button>
    </form>
    <form class="panel" @submit.prevent="post('exclusions', { start: exclusion.start, end: exclusion.end, reason: exclusion.reason || null }, () => { exclusion.start = ''; exclusion.end = ''; exclusion.reason = ''; })">
      <h2>Ajouter une exclusion</h2>
      <label>Début <input v-model="exclusion.start" required /></label>
      <label>Fin <input v-model="exclusion.end" required /></label>
      <label>Motif <input v-model="exclusion.reason" /></label>
      <button class="primary" type="submit">Ajouter</button>
    </form>
    <form class="panel" @submit.prevent="post('reservations', { address: reservation.address, macAddress: reservation.macAddress, hostname: reservation.hostname || undefined }, () => { reservation.address = ''; reservation.macAddress = ''; reservation.hostname = ''; })">
      <h2>Ajouter une réservation</h2>
      <label>Adresse <input v-model="reservation.address" required /></label>
      <label>MAC <input v-model="reservation.macAddress" required /></label>
      <label>Hôte <input v-model="reservation.hostname" /></label>
      <button class="primary" type="submit">Réserver</button>
    </form>
    <form class="panel" @submit.prevent="post('simulate', { macAddress: simulation.macAddress, hostname: simulation.hostname || undefined }, () => { simulation.macAddress = ''; simulation.hostname = ''; })">
      <h2>Simuler un bail</h2>
      <label>MAC <input v-model="simulation.macAddress" required /></label>
      <label>Hôte <input v-model="simulation.hostname" /></label>
      <button class="primary" type="submit">Simuler</button>
    </form>
  </div>
</template>
