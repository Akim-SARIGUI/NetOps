<script setup lang="ts">
import type { Device, Duplex, ListResponse, PoeStatus, PortStatus, SwitchingView, SwitchPort } from "~/types/api";

definePageMeta({ layout: "console", middleware: "auth" });

const route = useRoute();
const session = useSession();
const deviceId = computed(() => String(route.params.deviceId));

const { data: view, refresh } = await useFetch<SwitchingView>(() => `/api/backend/devices/${deviceId.value}/switching`);
const organizationId = ref("");
const { data: device } = await useFetch<Device>(() => `/api/backend/devices/${deviceId.value}`);
watch(device, (value) => {
  if (value) organizationId.value = value.organizationId;
}, { immediate: true });

const canWrite = computed(() => can(session.value, organizationId.value, "inventory:write"));
const canDelete = computed(() => can(session.value, organizationId.value, "inventory:delete"));
const { data: devices } = await useFetch<ListResponse<Device>>(
  () => (organizationId.value ? `/api/backend/organizations/${organizationId.value}/devices` : null),
  { watch: [organizationId] },
);

const message = ref("");
const access = reactive({
  name: "",
  status: "DOWN" as PortStatus,
  accessVlanId: "",
  speedMbps: null as number | null,
  duplex: "" as Duplex | "",
  description: "",
  connectedDeviceId: "",
  macAddress: "",
  poe: "OFF" as PoeStatus,
});
const trunk = reactive({
  name: "",
  status: "DOWN" as PortStatus,
  nativeVlanId: "",
  allowedVlanIds: [] as string[],
  speedMbps: null as number | null,
  duplex: "" as Duplex | "",
  description: "",
});
const assign = reactive({ portId: "", accessVlanId: "" });
const allowed = reactive({ portId: "", nativeVlanId: "", allowedVlanIds: [] as string[] });

const accessPorts = computed(() => (view.value?.ports ?? []).filter((port) => port.mode === "ACCESS"));
const trunkPorts = computed(() => (view.value?.ports ?? []).filter((port) => port.mode === "TRUNK"));

function toggle(list: string[], vlanId: string, checked: boolean) {
  const index = list.indexOf(vlanId);
  if (checked && index < 0) list.push(vlanId);
  if (!checked && index >= 0) list.splice(index, 1);
}

function onCheck(event: Event, list: string[], vlanId: string) {
  toggle(list, vlanId, (event.target as HTMLInputElement).checked);
}

function used(vlanId: string) {
  return (view.value?.ports ?? []).some(
    (port) =>
      port.accessVlan?.id === vlanId ||
      port.nativeVlan?.id === vlanId ||
      port.allowedVlans.some((vlan) => vlan.id === vlanId),
  );
}

watch(
  () => allowed.portId,
  (portId) => {
    const port = trunkPorts.value.find((item) => item.id === portId);
    allowed.allowedVlanIds = port ? port.allowedVlans.map((vlan) => vlan.id) : [];
    allowed.nativeVlanId = port?.nativeVlan?.id ?? "";
  },
);

function portPayload(source: { status: PortStatus; speedMbps: number | null; duplex: Duplex | ""; description: string }) {
  return {
    status: source.status,
    speedMbps: source.speedMbps || null,
    duplex: source.duplex || null,
    description: source.description || null,
  };
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

function createAccess() {
  return run(async () => {
    await $fetch(`/api/backend/devices/${deviceId.value}/ports`, {
      method: "POST",
      body: {
        name: access.name,
        mode: "ACCESS",
        accessVlanId: access.accessVlanId,
        connectedDeviceId: access.connectedDeviceId || null,
        macAddress: access.macAddress || null,
        poe: access.poe,
        ...portPayload(access),
      },
    });
    access.name = "";
    access.description = "";
    access.macAddress = "";
  });
}

function createTrunk() {
  return run(async () => {
    await $fetch(`/api/backend/devices/${deviceId.value}/ports`, {
      method: "POST",
      body: {
        name: trunk.name,
        mode: "TRUNK",
        nativeVlanId: trunk.nativeVlanId || null,
        allowedVlanIds: trunk.allowedVlanIds,
        ...portPayload(trunk),
      },
    });
    trunk.name = "";
    trunk.description = "";
    trunk.allowedVlanIds = [];
    trunk.nativeVlanId = "";
  });
}

function assignVlan() {
  return run(async () => {
    await $fetch(`/api/backend/ports/${assign.portId}`, {
      method: "PATCH",
      body: { accessVlanId: assign.accessVlanId },
    });
  });
}

function saveAllowed() {
  return run(async () => {
    await $fetch(`/api/backend/ports/${allowed.portId}`, {
      method: "PATCH",
      body: {
        mode: "TRUNK",
        nativeVlanId: allowed.nativeVlanId || null,
        allowedVlanIds: allowed.allowedVlanIds,
      },
    });
  });
}

function removePort(port: SwitchPort) {
  return run(async () => {
    await $fetch(`/api/backend/ports/${port.id}`, { method: "DELETE" });
  });
}
</script>

<template>
  <AppBreadcrumb
    :items="[
      { label: 'Commutation', to: '/switching' },
      { label: view?.device.hostname ?? 'Commutateur' },
    ]"
  />
  <header class="page-head">
    <div>
      <h1>{{ view?.device.hostname }}</h1>
      <p class="lede">{{ view?.device.site.name }} · VLAN et ports</p>
    </div>
  </header>
  <p v-if="message" class="banner">{{ message }}</p>

  <section class="panel" style="margin-bottom: 16px">
    <h2>Synthèse</h2>
    <pre class="tree">{{ view?.tree }}</pre>
  </section>

  <section v-if="view?.inconsistencies.length" class="panel" style="margin-bottom: 16px">
    <h2>Incohérences</h2>
    <ul>
      <li v-for="issue in view.inconsistencies" :key="issue.code + issue.message">{{ issue.message }}</li>
    </ul>
  </section>

  <div class="grid">
    <div class="stack">
      <section class="panel">
        <h2>Ports</h2>
        <table v-if="view?.ports.length">
          <thead>
            <tr>
              <th>Port</th>
              <th>Mode</th>
              <th>VLAN</th>
              <th>État</th>
              <th>PoE</th>
              <th>Raccordé</th>
              <th v-if="canDelete"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="port in view.ports" :key="port.id">
              <td class="mono">{{ port.name }}</td>
              <td>{{ portModeLabels[port.mode] }}</td>
              <td>{{ portAssignment(port) }}</td>
              <td><span class="pill" :class="port.status">{{ portStatusLabels[port.status] }}</span></td>
              <td>{{ poeLabels[port.poe] }}</td>
              <td>{{ port.connectedDevice?.hostname ?? "—" }}</td>
              <td v-if="canDelete"><button class="danger" type="button" @click="removePort(port)">Retirer</button></td>
            </tr>
          </tbody>
        </table>
        <p v-else class="empty">Aucun port.</p>
      </section>

      <section class="panel">
        <h2>VLAN du site</h2>
        <table v-if="view?.vlans.length">
          <thead>
            <tr>
              <th>ID</th>
              <th>Nom</th>
              <th>Rôle</th>
              <th>Zone</th>
              <th>Sur ce commutateur</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="vlan in view.vlans" :key="vlan.id">
              <td class="mono">{{ vlan.vid }}</td>
              <td>{{ vlan.name }}</td>
              <td>{{ vlanRoleLabels[vlan.role] }}</td>
              <td>{{ securityZoneLabels[vlan.securityZone] }}</td>
              <td>{{ used(vlan.id) ? "Oui" : "Non" }}</td>
            </tr>
          </tbody>
        </table>
        <p v-else class="empty">Aucun VLAN sur le site.</p>
      </section>
    </div>

    <div v-if="canWrite" class="stack">
      <form class="panel" @submit.prevent="createAccess">
        <h2>Port access</h2>
        <label>Numéro <input v-model="access.name" placeholder="Gi0/6" required /></label>
        <label>
          VLAN
          <select v-model="access.accessVlanId" required>
            <option value="" disabled>Choisir</option>
            <option v-for="vlan in view?.vlans ?? []" :key="vlan.id" :value="vlan.id">{{ vlan.vid }} · {{ vlan.name }}</option>
          </select>
        </label>
        <label>
          Statut
          <select v-model="access.status">
            <option v-for="(label, status) in portStatusLabels" :key="status" :value="status">{{ label }}</option>
          </select>
        </label>
        <label>Vitesse (Mbit/s) <input v-model.number="access.speedMbps" type="number" min="1" /></label>
        <label>
          Duplex
          <select v-model="access.duplex">
            <option value="">—</option>
            <option v-for="(label, duplex) in duplexLabels" :key="duplex" :value="duplex">{{ label }}</option>
          </select>
        </label>
        <label>Description <input v-model="access.description" /></label>
        <label>
          Équipement connecté
          <select v-model="access.connectedDeviceId">
            <option value="">—</option>
            <option v-for="item in devices?.data ?? []" :key="item.id" :value="item.id" :disabled="item.id === deviceId">
              {{ item.hostname }}
            </option>
          </select>
        </label>
        <label>MAC <input v-model="access.macAddress" placeholder="aa:bb:cc:dd:ee:ff" /></label>
        <label>
          PoE
          <select v-model="access.poe">
            <option v-for="(label, poe) in poeLabels" :key="poe" :value="poe">{{ label }}</option>
          </select>
        </label>
        <button class="primary" type="submit">Créer le port access</button>
      </form>

      <form class="panel" @submit.prevent="assignVlan">
        <h2>Affecter un VLAN</h2>
        <label>
          Port access
          <select v-model="assign.portId" required>
            <option value="" disabled>Choisir</option>
            <option v-for="port in accessPorts" :key="port.id" :value="port.id">{{ port.name }}</option>
          </select>
        </label>
        <label>
          VLAN
          <select v-model="assign.accessVlanId" required>
            <option value="" disabled>Choisir</option>
            <option v-for="vlan in view?.vlans ?? []" :key="vlan.id" :value="vlan.id">{{ vlan.vid }} · {{ vlan.name }}</option>
          </select>
        </label>
        <button class="primary" type="submit" :disabled="!assign.portId || !assign.accessVlanId">Affecter</button>
      </form>

      <form class="panel" @submit.prevent="createTrunk">
        <h2>Port trunk</h2>
        <label>Numéro <input v-model="trunk.name" placeholder="Gi0/7" required /></label>
        <p class="hint">VLAN autorisés</p>
        <div class="checks">
          <label v-for="vlan in view?.vlans ?? []" :key="vlan.id">
            <input
              type="checkbox"
              :checked="trunk.allowedVlanIds.includes(vlan.id)"
              @change="onCheck($event, trunk.allowedVlanIds, vlan.id)"
            />
            {{ vlan.vid }} {{ vlan.name }}
          </label>
        </div>
        <label>
          VLAN natif
          <select v-model="trunk.nativeVlanId">
            <option value="">Aucun</option>
            <option v-for="vlan in view?.vlans ?? []" :key="vlan.id" :value="vlan.id">{{ vlan.vid }} · {{ vlan.name }}</option>
          </select>
        </label>
        <label>Description <input v-model="trunk.description" /></label>
        <button class="primary" type="submit">Créer le trunk</button>
      </form>

      <form class="panel" @submit.prevent="saveAllowed">
        <h2>VLAN autorisés</h2>
        <label>
          Trunk
          <select v-model="allowed.portId" required>
            <option value="" disabled>Choisir</option>
            <option v-for="port in trunkPorts" :key="port.id" :value="port.id">{{ port.name }}</option>
          </select>
        </label>
        <div class="checks">
          <label v-for="vlan in view?.vlans ?? []" :key="vlan.id">
            <input
              type="checkbox"
              :checked="allowed.allowedVlanIds.includes(vlan.id)"
              @change="onCheck($event, allowed.allowedVlanIds, vlan.id)"
            />
            {{ vlan.vid }} {{ vlan.name }}
          </label>
        </div>
        <label>
          VLAN natif
          <select v-model="allowed.nativeVlanId">
            <option value="">Aucun</option>
            <option v-for="vlan in view?.vlans ?? []" :key="vlan.id" :value="vlan.id">{{ vlan.vid }} · {{ vlan.name }}</option>
          </select>
        </label>
        <button class="primary" type="submit" :disabled="!allowed.portId">Enregistrer</button>
      </form>
    </div>
  </div>
</template>
