<script setup lang="ts">
import type { Device, IpamOverview, ListResponse, Organization, RoutingOverview, Site } from "~/types/api";

definePageMeta({ layout: "console", middleware: "auth" });

const session = useSession();
const { data: organizations } = await useFetch<ListResponse<Organization>>("/api/backend/organizations");
const organizationId = ref(organizations.value?.data[0]?.id ?? "");
const siteId = ref("");
const canWrite = computed(() => can(session.value, organizationId.value, "inventory:write"));
const canDelete = computed(() => can(session.value, organizationId.value, "inventory:delete"));
const query = computed(() => (siteId.value ? { siteId: siteId.value } : {}));
const { data: sites } = await useFetch<ListResponse<Site>>(
  () => (organizationId.value ? `/api/backend/organizations/${organizationId.value}/sites` : null),
  { watch: [organizationId] },
);
const { data: routing, refresh } = await useFetch<RoutingOverview>(
  () => (organizationId.value ? `/api/backend/organizations/${organizationId.value}/routing` : null),
  { query, watch: [organizationId, query] },
);
const { data: devices } = await useFetch<ListResponse<Device>>(
  () => (organizationId.value ? `/api/backend/organizations/${organizationId.value}/devices` : null),
  { watch: [organizationId] },
);
const { data: ipam } = await useFetch<IpamOverview>(
  () => (organizationId.value ? `/api/backend/organizations/${organizationId.value}/ipam` : null),
  { watch: [organizationId] },
);

const message = ref("");
const interfaceForm = reactive({ deviceId: "", name: "", kind: "SVI", parentInterfaceId: "", address: "", subnetId: "" });
const routeForm = reactive({ deviceId: "", protocol: "STATIC", cidr: "", gateway: "", layer3InterfaceId: "", metric: "" });
const ospfForm = reactive({ deviceId: "", processId: "1", routerId: "", areaId: "0.0.0.0", interfaceId: "" });
const { data: selectedDevice } = await useFetch<Device>(
  () => (interfaceForm.deviceId ? `/api/backend/devices/${interfaceForm.deviceId}` : null),
  { watch: [() => interfaceForm.deviceId] },
);
const subnets = computed(() => (ipam.value?.networks ?? []).flatMap((network) => network.subnets.map((subnet) => ({ id: subnet.id, label: `VLAN ${subnet.vlan.vid} ${subnet.vlan.name} · ${subnet.cidr}` }))));
const deviceInterfaces = computed(() => (routing.value?.interfaces ?? []).filter((item) => item.device.id === routeForm.deviceId || item.device.id === ospfForm.deviceId));

watch(organizationId, () => {
  siteId.value = "";
});
watch(() => routeForm.protocol, (protocol) => {
  if (protocol === "DEFAULT") routeForm.cidr = "0.0.0.0/0";
});

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

function kindLabel(value: string) {
  if (value === "SVI") return "SVI";
  if (value === "SUBINTERFACE") return "Sous-interface";
  return "Physique";
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

function createInterface() {
  return run(async () => {
    await $fetch(`/api/backend/organizations/${organizationId.value}/routing/interfaces`, {
      method: "POST",
      body: {
        deviceId: interfaceForm.deviceId,
        name: interfaceForm.name,
        kind: interfaceForm.kind,
        parentInterfaceId: interfaceForm.kind === "SVI" ? undefined : interfaceForm.parentInterfaceId,
        address: interfaceForm.address,
        subnetId: interfaceForm.subnetId,
        status: "PLANNED",
      },
    });
    interfaceForm.name = "";
    interfaceForm.address = "";
  });
}

function createRoute() {
  return run(async () => {
    await $fetch(`/api/backend/organizations/${organizationId.value}/routing/routes`, {
      method: "POST",
      body: {
        deviceId: routeForm.deviceId,
        protocol: routeForm.protocol,
        cidr: routeForm.cidr,
        gateway: routeForm.gateway,
        layer3InterfaceId: routeForm.layer3InterfaceId || undefined,
        ...(routeForm.metric ? { metric: Number(routeForm.metric) } : {}),
      },
    });
    routeForm.cidr = routeForm.protocol === "DEFAULT" ? "0.0.0.0/0" : "";
    routeForm.gateway = "";
  });
}

function createOspf() {
  return run(async () => {
    await $fetch(`/api/backend/organizations/${organizationId.value}/routing/ospf`, {
      method: "POST",
      body: {
        deviceId: ospfForm.deviceId,
        processId: Number(ospfForm.processId),
        routerId: ospfForm.routerId,
        areaId: ospfForm.areaId || undefined,
        interfaceIds: ospfForm.interfaceId ? [ospfForm.interfaceId] : undefined,
      },
    });
    ospfForm.routerId = "";
  });
}

function remove(path: string) {
  return run(() => $fetch(path, { method: "DELETE" }));
}
</script>

<template>
  <header class="page-head">
    <div>
      <h1>Routage</h1>
      <p class="lede">{{ routing?.notice }}</p>
    </div>
    <label>
      Site
      <select v-model="siteId">
        <option value="">Tous</option>
        <option v-for="site in sites?.data ?? []" :key="site.id" :value="site.id">{{ site.name }}</option>
      </select>
    </label>
  </header>
  <p v-if="message" class="banner">{{ message }}</p>
  <div class="metrics">
    <article class="metric"><span>Routes</span><strong>{{ routing?.totals.routes ?? 0 }}</strong></article>
    <article class="metric"><span>Interfaces</span><strong>{{ routing?.totals.interfaces ?? 0 }}</strong></article>
    <article class="metric"><span>Chemins inter-VLAN</span><strong>{{ routing?.totals.paths ?? 0 }}</strong></article>
    <article class="metric"><span>Alertes</span><strong>{{ routing?.totals.alerts ?? 0 }}</strong></article>
  </div>

  <section class="panel" style="margin-bottom: 16px">
    <h2>Inter-VLAN</h2>
    <div v-if="routing?.paths.length" class="stack">
      <article v-for="path in routing.paths" :key="path.fromVlan.id + '-' + path.toVlan.id + '-' + path.router.id">
        <ol class="chain">
          <li>
            <h3>VLAN {{ path.fromVlan.vid }}</h3>
            <strong>{{ path.fromVlan.name }}</strong>
            <p class="hint">{{ kindLabel(path.fromInterface.kind) }} {{ path.fromInterface.name }}</p>
          </li>
          <li>
            <h3>Passerelle</h3>
            <span class="mono">{{ path.gateway }}</span>
          </li>
          <li>
            <h3>Routeur</h3>
            <NuxtLink :to="'/routing/' + path.router.id">{{ path.router.hostname }}</NuxtLink>
          </li>
          <li>
            <h3>VLAN {{ path.toVlan.vid }}</h3>
            <strong>{{ path.toVlan.name }}</strong>
            <p class="hint">{{ kindLabel(path.toInterface.kind) }} {{ path.toInterface.name }} · {{ path.toGateway }}</p>
          </li>
        </ol>
      </article>
    </div>
    <p v-else class="empty">Aucun chemin inter-VLAN.</p>
  </section>

  <section class="panel" style="margin-bottom: 16px">
    <h2>Tables par équipement</h2>
    <ul v-if="routing?.devices.length">
      <li v-for="device in routing.devices" :key="device.id">
        <NuxtLink :to="'/routing/' + device.id">{{ device.hostname }}</NuxtLink>
        · {{ device.routes }} routes
      </li>
    </ul>
    <p v-else class="empty">Aucun équipement routé.</p>
  </section>

  <section class="panel" style="margin-bottom: 16px">
    <h2>OSPF</h2>
    <p class="hint">{{ routing?.ospfNotice }}</p>
    <ul v-if="routing?.ospf.length">
      <li v-for="process in routing.ospf" :key="process.id">
        {{ process.device.hostname }} · processus {{ process.processId }} · router-id <span class="mono">{{ process.routerId }}</span>
        · {{ statusLabel(process.status) }}
        <span v-for="area in process.areas" :key="area.id"> · aire {{ area.areaId }} ({{ area.interfaces.map((item) => item.name).join(', ') || 'aucune interface' }})</span>
        <button v-if="canDelete" class="ghost" type="button" @click="remove('/api/backend/routing/ospf/' + process.id)">Retirer</button>
      </li>
    </ul>
    <p v-else class="empty">Aucun processus OSPF.</p>
  </section>

  <template v-if="canWrite">
    <section class="panel" style="margin-bottom: 16px">
      <h2>Interface de routage</h2>
      <form class="grid" @submit.prevent="createInterface">
        <label>Équipement
          <select v-model="interfaceForm.deviceId" required>
            <option value="">Choisir</option>
            <option v-for="device in devices?.data ?? []" :key="device.id" :value="device.id">{{ device.hostname }}</option>
          </select>
        </label>
        <label>Nom <input v-model="interfaceForm.name" required placeholder="Vlan10" /></label>
        <label>Type
          <select v-model="interfaceForm.kind">
            <option value="PHYSICAL">Physique</option>
            <option value="SVI">SVI</option>
            <option value="SUBINTERFACE">Sous-interface</option>
          </select>
        </label>
        <label v-if="interfaceForm.kind !== 'SVI'">Parente
          <select v-model="interfaceForm.parentInterfaceId" required>
            <option value="">Choisir</option>
            <option v-for="item in selectedDevice?.interfaces ?? []" :key="item.id" :value="item.id">{{ item.name }}</option>
          </select>
        </label>
        <label>Adresse <input v-model="interfaceForm.address" required placeholder="10.1.10.1" /></label>
        <label>Sous-réseau
          <select v-model="interfaceForm.subnetId" required>
            <option value="">Choisir</option>
            <option v-for="subnet in subnets" :key="subnet.id" :value="subnet.id">{{ subnet.label }}</option>
          </select>
        </label>
        <button type="submit">Ajouter l'interface</button>
      </form>
    </section>
    <section class="panel" style="margin-bottom: 16px">
      <h2>Nouvelle route</h2>
      <form class="grid" @submit.prevent="createRoute">
        <label>Équipement
          <select v-model="routeForm.deviceId" required>
            <option value="">Choisir</option>
            <option v-for="device in routing?.devices ?? []" :key="device.id" :value="device.id">{{ device.hostname }}</option>
          </select>
        </label>
        <label>Protocole
          <select v-model="routeForm.protocol">
            <option value="STATIC">Statique</option>
            <option value="DEFAULT">Défaut</option>
          </select>
        </label>
        <label>Destination <input v-model="routeForm.cidr" required placeholder="10.1.30.0/24" /></label>
        <label>Passerelle <input v-model="routeForm.gateway" required placeholder="10.0.0.3" /></label>
        <label>Interface
          <select v-model="routeForm.layer3InterfaceId">
            <option value="">Automatique</option>
            <option v-for="item in deviceInterfaces.filter((entry) => entry.device.id === routeForm.deviceId)" :key="item.id" :value="item.id">{{ item.name }}</option>
          </select>
        </label>
        <label>Métrique <input v-model="routeForm.metric" inputmode="numeric" placeholder="1" /></label>
        <button type="submit">Ajouter la route</button>
      </form>
    </section>
    <section class="panel" style="margin-bottom: 16px">
      <h2>Processus OSPF</h2>
      <form class="grid" @submit.prevent="createOspf">
        <label>Équipement
          <select v-model="ospfForm.deviceId" required>
            <option value="">Choisir</option>
            <option v-for="device in routing?.devices ?? []" :key="device.id" :value="device.id">{{ device.hostname }}</option>
          </select>
        </label>
        <label>Processus <input v-model="ospfForm.processId" required /></label>
        <label>Router-id <input v-model="ospfForm.routerId" required placeholder="10.0.0.1" /></label>
        <label>Aire <input v-model="ospfForm.areaId" placeholder="0.0.0.0" /></label>
        <label>Interface
          <select v-model="ospfForm.interfaceId">
            <option value="">Aucune</option>
            <option v-for="item in deviceInterfaces.filter((entry) => entry.device.id === ospfForm.deviceId)" :key="item.id" :value="item.id">{{ item.name }}</option>
          </select>
        </label>
        <button type="submit">Préparer OSPF</button>
      </form>
    </section>
  </template>
</template>
