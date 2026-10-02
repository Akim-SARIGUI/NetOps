<script setup lang="ts">
import type { DeviceRoutingTable } from "~/types/api";

definePageMeta({ layout: "console", middleware: "auth" });

const route = useRoute();
const session = useSession();
const deviceId = computed(() => String(route.params.deviceId));
const { data: table, refresh } = await useFetch<DeviceRoutingTable>(() => `/api/backend/routing/devices/${deviceId.value}`, { watch: [deviceId] });
const canDelete = computed(() => can(session.value, table.value?.organizationId ?? "", "inventory:delete"));
const message = ref("");

function protocolLabel(value: string) {
  if (value === "CONNECTED") return "Connectée";
  if (value === "STATIC") return "Statique";
  if (value === "DEFAULT") return "Défaut";
  return "OSPF";
}

function statusLabel(value: string) {
  if (value === "ACTIVE") return "Actif";
  if (value === "PLANNED") return "Prévu";
  if (value === "DISABLED") return "Désactivé";
  return value;
}

async function remove(path: string) {
  message.value = "";
  try {
    await $fetch(path, { method: "DELETE" });
    await refresh();
  } catch (error) {
    message.value = apiErrorMessage(error);
  }
}
</script>

<template>
  <AppBreadcrumb :items="[{ label: 'Routage', to: '/routing' }, { label: table?.device.hostname ?? 'Équipement' }]" />
  <header class="page-head">
    <div>
      <h1>{{ table?.device.hostname }}</h1>
      <p class="lede">{{ table?.notice }}</p>
    </div>
  </header>
  <p v-if="message" class="banner">{{ message }}</p>
  <section class="panel" style="margin-bottom: 16px">
    <h2>Table de routage</h2>
    <table v-if="table?.routes.length">
      <thead>
        <tr>
          <th>Destination</th>
          <th>Préfixe</th>
          <th>Passerelle</th>
          <th>Interface</th>
          <th>Métrique</th>
          <th>Protocole</th>
          <th>Équipement</th>
          <th>État</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="item in table.routes" :key="item.id">
          <td class="mono">{{ item.cidr }}</td>
          <td>/{{ item.prefix }}</td>
          <td class="mono">{{ item.gateway || "—" }}</td>
          <td>{{ item.interface?.name || "—" }}</td>
          <td>{{ item.metric }}</td>
          <td>{{ protocolLabel(item.protocol) }}</td>
          <td>{{ item.device.hostname }}</td>
          <td>
            {{ statusLabel(item.status) }}
            <p v-for="issue in item.issues" :key="issue.code" class="hint">{{ issue.message }}</p>
          </td>
          <td>
            <button v-if="canDelete && !item.derived" class="ghost" type="button" @click="remove('/api/backend/routing/routes/' + item.id)">Retirer</button>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else class="empty">Aucune route.</p>
  </section>
  <section class="panel">
    <h2>OSPF</h2>
    <p class="hint">{{ table?.ospf?.notice || table?.ospfNotice }}</p>
    <p v-if="table?.ospf">Processus {{ table.ospf.processId }} · router-id <span class="mono">{{ table.ospf.routerId }}</span> · {{ statusLabel(table.ospf.status) }}</p>
    <p v-else class="empty">Aucun processus sur cet équipement.</p>
  </section>
</template>
