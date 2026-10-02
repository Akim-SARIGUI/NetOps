<script setup lang="ts">
import type { DiagnosticOverview, Device, ListResponse, Organization } from "~/types/api";

definePageMeta({ layout: "console", middleware: "auth" });

const tools = [
  { id: "PING", label: "Ping" },
  { id: "TRACEROUTE", label: "Traceroute" },
  { id: "DNS", label: "DNS Lookup" },
  { id: "TCP", label: "TCP" },
  { id: "ARP", label: "ARP" },
  { id: "ROUTE", label: "Route lookup" },
  { id: "HTTP", label: "HTTP" },
  { id: "PORT", label: "Port autorisé" },
];

const session = useSession();
const { data: organizations } = await useFetch<ListResponse<Organization>>("/api/backend/organizations");
const organizationId = ref(organizations.value?.data[0]?.id ?? "");
const canWrite = computed(() => can(session.value, organizationId.value, "inventory:write"));
const { data: diagnostics, refresh } = await useFetch<DiagnosticOverview>(
  () => (organizationId.value ? `/api/backend/organizations/${organizationId.value}/diagnostics` : null),
  { watch: [organizationId] },
);
const { data: devices } = await useFetch<ListResponse<Device>>(
  () => (organizationId.value ? `/api/backend/organizations/${organizationId.value}/devices` : null),
  { watch: [organizationId] },
);

const message = ref("");
const form = reactive({ deviceId: "", tool: "PING", mode: "INVENTORY", port: "80", name: "" });

const guide = computed(() => diagnostics.value?.guide ?? []);

async function launchProbe() {
  message.value = "";
  const body: { deviceId: string; tool: string; mode: string; port?: number; name?: string } = {
    deviceId: form.deviceId,
    tool: form.tool,
    mode: form.mode,
  };
  if (form.tool === "PORT") body.port = Number(form.port);
  if (form.name.trim()) body.name = form.name.trim();
  try {
    await $fetch(`/api/backend/organizations/${organizationId.value}/diagnostics/probes`, { method: "POST", body });
    await refresh();
  } catch (error) {
    message.value = apiErrorMessage(error);
  }
}
</script>

<template>
  <header class="page-head">
    <div>
      <h1>Diagnostic</h1>
      <p class="lede">{{ diagnostics?.notice }}</p>
    </div>
  </header>
  <p v-if="message" class="banner">{{ message }}</p>
  <p>{{ diagnostics?.probeNotice }}</p>
  <p>
    <template v-for="(step, index) in diagnostics?.steps ?? []" :key="step.id">
      <span>{{ step.label }}</span>
      <span v-if="index < (diagnostics?.steps.length ?? 0) - 1"> → </span>
    </template>
  </p>

  <section v-if="canWrite" class="panel" style="margin: 16px 0">
    <h2>Lancer la sonde</h2>
    <form class="grid" @submit.prevent="launchProbe">
      <label>Équipement
        <select v-model="form.deviceId" required>
          <option value="">Choisir</option>
          <option v-for="device in devices?.data ?? []" :key="device.id" :value="device.id">{{ device.hostname }}</option>
        </select>
      </label>
      <label>Sonde
        <select v-model="form.tool">
          <option v-for="tool in tools" :key="tool.id" :value="tool.id">{{ tool.label }}</option>
        </select>
      </label>
      <label>Mode
        <select v-model="form.mode">
          <option value="INVENTORY">Inventaire</option>
          <option value="LIVE">Sonde réelle</option>
        </select>
      </label>
      <label v-if="form.tool === 'PORT'">Port autorisé <input v-model="form.port" inputmode="numeric" required /></label>
      <label v-if="form.tool === 'DNS'">Nom <input v-model="form.name" /></label>
      <button type="submit">Lancer la sonde</button>
    </form>
  </section>

  <section class="panel">
    <h2>{{ diagnostics?.device?.hostname ?? "Aucun équipement" }}</h2>
    <article v-for="item in guide" :key="item.step" style="margin-top: 16px">
      <h3>{{ item.label }}</h3>
      <p><strong>FACT</strong> {{ item.fact }}</p>
      <p><strong>OBSERVATION</strong> {{ item.observation }}</p>
      <p><strong>POSSIBLE CAUSE</strong> {{ item.possibleCause }}</p>
      <p><strong>RECOMMENDED CHECK</strong> {{ item.recommendedCheck }}</p>
    </article>
    <p v-if="!guide.length" class="empty">Aucun diagnostic.</p>
  </section>
</template>
