<script setup lang="ts">
import type { VlanFabric } from "~/types/api";

definePageMeta({ layout: "console", middleware: "auth" });

const route = useRoute();
const session = useSession();
const vlanId = computed(() => String(route.params.vlanId));
const { data: vlan, refresh } = await useFetch<VlanFabric>(() => `/api/backend/vlans/${vlanId.value}`);
const canWrite = computed(() => can(session.value, vlan.value?.organizationId ?? "", "inventory:write"));
const message = ref("");
const form = reactive({ cidr: "", gateway: "" });
const roleLabels: Record<string, string> = { GATEWAY: "Passerelle", ALLOCATED: "Allouée", RESERVED: "Réservée" };

async function attach() {
  message.value = "";
  try {
    await $fetch(`/api/backend/vlans/${vlanId.value}/subnet`, { method: "POST", body: form });
    form.cidr = "";
    form.gateway = "";
    await refresh();
  } catch (error) {
    message.value = apiErrorMessage(error);
  }
}
</script>

<template>
  <AppBreadcrumb :items="[{ label: 'Commutation', to: '/switching' }, { label: vlan ? `VLAN ${vlan.vid}` : 'VLAN' }]" />
  <header class="page-head">
    <div>
      <h1>VLAN {{ vlan?.vid }} · {{ vlan?.name }}</h1>
      <p class="lede">
        {{ vlan ? vlanRoleLabels[vlan.role] : "" }}
        · {{ vlan ? securityZoneLabels[vlan.securityZone] : "" }}
        · {{ vlan?.site.name }}
      </p>
    </div>
  </header>
  <p v-if="message" class="banner">{{ message }}</p>
  <section v-if="vlan?.issues.length" class="panel" style="margin-bottom: 16px">
    <h2>Alertes</h2>
    <ul>
      <li v-for="issue in vlan.issues" :key="issue.code + issue.message">{{ issue.message }}</li>
    </ul>
  </section>

  <section class="panel">
    <ol class="chain">
      <li>
        <h3>VLAN</h3>
        <strong>{{ vlan?.vid }} {{ vlan?.name }}</strong>
        <p class="hint">{{ vlan?.description || "Pas de description" }}</p>
      </li>
      <li>
        <h3>Sous-réseau</h3>
        <ul v-if="vlan?.subnets.length">
          <li v-for="subnet in vlan.subnets" :key="subnet.id">
            <NuxtLink class="row-link" :to="`/subnets/${subnet.id}`">{{ subnet.cidr }}</NuxtLink>
            <span v-if="subnet.stats" class="hint"> · {{ subnet.stats.used }} / {{ subnet.stats.usable }} utilisées</span>
          </li>
        </ul>
        <p v-else class="empty">Aucun sous-réseau associé.</p>
      </li>
      <li>
        <h3>Passerelle</h3>
        <ul v-if="vlan?.subnets.some((subnet) => subnet.gateway)">
          <li v-for="subnet in vlan.subnets.filter((item) => item.gateway)" :key="subnet.id">
            <span class="mono">{{ subnet.gateway?.address }}</span>
            <span v-if="subnet.gateway?.interface"> · {{ subnet.gateway.interface.device.hostname }} {{ subnet.gateway.interface.name }}</span>
            <span v-else class="hint"> · non portée</span>
          </li>
        </ul>
        <p v-else class="empty">Aucune passerelle.</p>
      </li>
      <li>
        <h3>IP utilisées</h3>
        <ul v-if="vlan?.subnets.some((subnet) => subnet.addresses.length)">
          <li v-for="subnet in vlan.subnets" :key="subnet.id">
            <span v-for="address in subnet.addresses" :key="address.id">
              <span class="mono">{{ address.address }}</span> {{ roleLabels[address.role] }}
              <span v-if="address.device"> · {{ address.device.hostname }} {{ address.interfaceName }}</span>
              <span v-if="address.description"> · {{ address.description }}</span>
              <br />
            </span>
          </li>
        </ul>
        <p v-else class="empty">Aucune adresse enregistrée.</p>
      </li>
      <li>
        <h3>Commutateurs</h3>
        <ul v-if="vlan?.switches.length">
          <li v-for="device in vlan.switches" :key="device.id">
            <NuxtLink class="row-link" :to="`/switches/${device.id}`">{{ device.hostname }}</NuxtLink>
          </li>
        </ul>
        <p v-else class="empty">Aucun commutateur ne transporte ce VLAN.</p>
      </li>
      <li>
        <h3>Ports</h3>
        <ul v-if="vlan?.ports.length">
          <li v-for="port in vlan.ports" :key="port.id">
            <span class="mono">{{ port.switch.hostname }} {{ port.name }}</span>
            · {{ portModeLabels[port.mode] }}
            <span v-if="port.connectedDevice"> · {{ port.connectedDevice.hostname }}</span>
          </li>
        </ul>
        <p v-else class="empty">Aucun port.</p>
      </li>
      <li>
        <h3>Équipements</h3>
        <ul v-if="vlan?.equipment.length">
          <li v-for="device in vlan.equipment" :key="device.id">
            <NuxtLink class="row-link" :to="`/devices/${device.id}`">{{ device.hostname }}</NuxtLink>
            <span class="hint"> · {{ device.via }}</span>
          </li>
        </ul>
        <p v-else class="empty">Aucun équipement rattaché.</p>
      </li>
    </ol>
  </section>

  <form v-if="canWrite && vlan && vlan.subnets.length === 0" class="panel" style="margin-top: 16px" @submit.prevent="attach">
    <h2>Associer un sous-réseau</h2>
    <label>CIDR <input v-model="form.cidr" placeholder="192.168.20.0/24" required /></label>
    <label>Passerelle <input v-model="form.gateway" placeholder="192.168.20.1" required /></label>
    <button class="primary" type="submit">Associer</button>
  </form>
</template>
