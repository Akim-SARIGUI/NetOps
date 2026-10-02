<script setup lang="ts">
import type { DnsRecordType, DnsResolution, DnsZoneDetail } from "~/types/api";

definePageMeta({ layout: "console", middleware: "auth" });

const route = useRoute();
const session = useSession();
const zoneId = computed(() => String(route.params.zoneId));
const { data: zone, refresh } = await useFetch<DnsZoneDetail>(() => `/api/backend/dns/zones/${zoneId.value}`);
const canWrite = computed(() => can(session.value, zone.value?.organizationId ?? "", "inventory:write"));
const message = ref("");
const resolution = ref<DnsResolution | null>(null);
const record = reactive({ name: "", type: "A" as DnsRecordType, value: "", priority: 10, weight: 0, port: 443 });
const lookup = reactive({ name: "", type: "" });
const types: DnsRecordType[] = ["A", "AAAA", "CNAME", "MX", "NS", "PTR", "TXT", "SRV"];

async function run(action: () => Promise<void>) {
  message.value = "";
  try {
    await action();
    await refresh();
  } catch (error) {
    message.value = apiErrorMessage(error);
  }
}

function addRecord() {
  return run(async () => {
    await $fetch(`/api/backend/dns/zones/${zoneId.value}/records`, {
      method: "POST",
      body: {
        name: record.name,
        type: record.type,
        value: record.value,
        ...(record.type === "MX" || record.type === "SRV" ? { priority: Number(record.priority) } : {}),
        ...(record.type === "SRV" ? { weight: Number(record.weight), port: Number(record.port) } : {}),
      },
    });
    record.name = "";
    record.value = "";
  });
}

function resolveName() {
  return run(async () => {
    resolution.value = await $fetch<DnsResolution>(`/api/backend/dns/zones/${zoneId.value}/resolve`, {
      method: "POST",
      body: { name: lookup.name, ...(lookup.type ? { type: lookup.type } : {}) },
    });
  });
}
</script>

<template>
  <AppBreadcrumb :items="[{ label: 'DNS', to: '/dns' }, { label: zone?.name ?? 'Zone' }]" />
  <header class="page-head">
    <div>
      <h1>{{ zone?.name }}</h1>
      <p class="lede">{{ zone?.notice }} {{ zone?.kind === 'REVERSE' ? 'Zone inverse' : 'Zone directe' }} · {{ zone?.server.name }}</p>
    </div>
  </header>
  <p v-if="message" class="banner">{{ message }}</p>
  <section v-if="zone?.issues.length" class="panel" style="margin-bottom: 16px">
    <h2>Alertes</h2>
    <ul>
      <li v-for="issue in zone.issues" :key="issue.code + issue.message">{{ issue.message }}</li>
    </ul>
  </section>
  <section class="panel">
    <ol class="chain">
      <li>
        <h3>Zone</h3>
        <strong>{{ zone?.chain.zone.name }}</strong>
        <p class="hint">{{ zone?.chain.zone.kind === 'REVERSE' ? 'Inverse' : 'Directe' }}<span v-if="zone?.subnet"> · VLAN {{ zone.subnet.vlan.vid }} · {{ zone.subnet.cidr }}</span></p>
      </li>
      <li>
        <h3>Enregistrements</h3>
        <ul v-if="zone?.chain.records.length">
          <li v-for="item in zone.chain.records" :key="item.id"><span class="mono">{{ item.fqdn }}</span> {{ item.type }} {{ item.value }}</li>
        </ul>
        <p v-else class="empty">Aucun enregistrement.</p>
      </li>
      <li>
        <h3>IP</h3>
        <ul v-if="zone?.chain.addresses.length">
          <li v-for="item in zone.chain.addresses" :key="item.address" class="mono">{{ item.address }}</li>
        </ul>
        <p v-else class="empty">Aucune adresse liée.</p>
      </li>
      <li>
        <h3>Équipements</h3>
        <ul v-if="zone?.chain.devices.length">
          <li v-for="device in zone.chain.devices" :key="device.id">
            <NuxtLink class="row-link" :to="`/devices/${device.id}`">{{ device.hostname }}</NuxtLink>
          </li>
        </ul>
        <p v-else class="empty">Aucun équipement.</p>
      </li>
      <li>
        <h3>Sous-réseaux</h3>
        <ul v-if="zone?.chain.subnets.length">
          <li v-for="subnet in zone.chain.subnets" :key="subnet.id">
            <NuxtLink class="row-link" :to="`/subnets/${subnet.id}`">{{ subnet.cidr }}</NuxtLink> · {{ subnet.name }}
          </li>
        </ul>
        <p v-else class="empty">Aucun sous-réseau.</p>
      </li>
      <li>
        <h3>VLAN</h3>
        <ul v-if="zone?.chain.vlans.length">
          <li v-for="vlan in zone.chain.vlans" :key="vlan.id">
            <NuxtLink class="row-link" :to="`/vlans/${vlan.id}`">VLAN {{ vlan.vid }} {{ vlan.name }}</NuxtLink>
          </li>
        </ul>
        <p v-else class="empty">Aucun VLAN.</p>
      </li>
    </ol>
  </section>
  <section class="panel" style="margin-top: 16px">
    <h2>Historique</h2>
    <ul v-if="zone?.history.length">
      <li v-for="change in zone.history" :key="change.id">{{ change.summary }} <span v-if="change.actor" class="hint">· {{ change.actor.name }}</span></li>
    </ul>
    <p v-else class="empty">Aucun changement.</p>
  </section>
  <div v-if="canWrite" class="grid" style="margin-top: 16px">
    <form class="panel" @submit.prevent="addRecord">
      <h2>Ajouter un enregistrement</h2>
      <label>Nom <input v-model="record.name" placeholder="intranet" required /></label>
      <label>Type <select v-model="record.type"><option v-for="item in types" :key="item" :value="item">{{ item }}</option></select></label>
      <label>Valeur <input v-model="record.value" required /></label>
      <label v-if="record.type === 'MX' || record.type === 'SRV'">Priorité <input v-model.number="record.priority" type="number" min="0" /></label>
      <label v-if="record.type === 'SRV'">Poids <input v-model.number="record.weight" type="number" min="0" /></label>
      <label v-if="record.type === 'SRV'">Port <input v-model.number="record.port" type="number" min="1" /></label>
      <button class="primary" type="submit">Ajouter</button>
    </form>
    <form class="panel" @submit.prevent="resolveName">
      <h2>Tester la résolution</h2>
      <p class="hint">Le test lit uniquement les zones enregistrées ici.</p>
      <label>Nom <input v-model="lookup.name" placeholder="intranet.entreprise.local" required /></label>
      <label>Type <select v-model="lookup.type"><option value="">Automatique</option><option v-for="item in types" :key="item" :value="item">{{ item }}</option></select></label>
      <button class="primary" type="submit">Résoudre</button>
      <p v-if="resolution">{{ resolution.message }}</p>
      <ul v-if="resolution?.answers.length">
        <li v-for="answer in resolution.answers" :key="answer.name + answer.type + answer.rdata">
          <span class="mono">{{ answer.name }}</span> {{ answer.type }} {{ answer.rdata }}
          <span v-if="answer.link?.device"> · {{ answer.link.device.hostname }}</span>
          <span v-if="answer.link?.subnet"> · {{ answer.link.subnet.cidr }}</span>
          <span v-if="answer.link?.vlan"> · VLAN {{ answer.link.vlan.vid }}</span>
        </li>
      </ul>
    </form>
  </div>
</template>
