<script setup lang="ts">
import type { ListResponse, Organization, Site, TopologyLink, TopologyNode, TopologyOverview, Vlan } from "~/types/api";

definePageMeta({ layout: "console", middleware: "auth" });

const route = useRoute();
const session = useSession();
const { data: organizations } = await useFetch<ListResponse<Organization>>("/api/backend/organizations");
const organizationId = ref(organizations.value?.data[0]?.id ?? "");
const siteId = ref("");
const q = ref(typeof route.query.q === "string" ? route.query.q : "");
const zoom = ref(1);
const canWrite = computed(() => can(session.value, organizationId.value, "inventory:write"));
const canDelete = computed(() => can(session.value, organizationId.value, "inventory:delete"));
const query = computed(() => ({ ...(siteId.value ? { siteId: siteId.value } : {}), ...(q.value.trim() ? { q: q.value.trim() } : {}) }));
const { data: sites } = await useFetch<ListResponse<Site>>(
  () => (organizationId.value ? `/api/backend/organizations/${organizationId.value}/sites` : null),
  { watch: [organizationId] },
);
const { data: topology, refresh } = await useFetch<TopologyOverview>(
  () => (organizationId.value ? `/api/backend/organizations/${organizationId.value}/topology` : null),
  { query, watch: [organizationId, query] },
);
const { data: vlans } = await useFetch<ListResponse<Vlan>>(
  () => (organizationId.value ? `/api/backend/organizations/${organizationId.value}/vlans` : null),
  { query: computed(() => (siteId.value ? { siteId: siteId.value } : {})), watch: [organizationId, siteId] },
);

const message = ref("");
const positions = reactive<Record<string, { x: number; y: number }>>({});
const linkForm = reactive({ sourceId: "", targetId: "", sourcePort: "", targetPort: "", speedMbps: "", status: "UP", vlanId: "", trafficBps: "" });
const drag = ref<{ id: string; kind: TopologyNode["kind"]; startX: number; startY: number; originX: number; originY: number } | null>(null);
const viewBox = computed(() => `0 0 ${1700 / zoom.value} ${760 / zoom.value}`);

watch(organizationId, () => {
  siteId.value = "";
});
watch(topology, () => {
  for (const key of Object.keys(positions)) delete positions[key];
});

function roleLabel(role: string) {
  if (role === "ROUTER") return "Routeur";
  if (role === "SWITCH") return "Commutateur";
  if (role === "FIREWALL") return "Pare-feu";
  if (role === "SERVER") return "Serveur";
  if (role === "ACCESS_POINT") return "Borne";
  if (role === "CLIENT") return "Client";
  return "Internet";
}

function roleStroke(role: string | null | undefined, simulated: boolean) {
  if (simulated) return "#ea580c";
  if (role === "ROUTER") return "#2563eb";
  if (role === "SWITCH") return "#0891b2";
  if (role === "FIREWALL") return "#dc2626";
  if (role === "SERVER") return "#7c3aed";
  if (role === "ACCESS_POINT") return "#16a34a";
  if (role === "CLIENT") return "#64748b";
  return "#0284c7";
}

function roleFill(simulated: boolean) {
  return simulated ? "#fff7ed" : "#ffffff";
}

function point(node: TopologyNode) {
  return positions[node.id] ?? { x: node.x, y: node.y };
}

function nodeById(id: string) {
  return topology.value?.nodes.find((node) => node.id === id);
}

function ends(link: TopologyLink) {
  const source = nodeById(link.sourceId);
  const target = nodeById(link.targetId);
  if (!source || !target) return null;
  const from = point(source);
  const to = point(target);
  return { x1: from.x + 74, y1: from.y + 36, x2: to.x + 74, y2: to.y + 36 };
}

function speedLabel(value: number | null) {
  if (!value) return "vitesse inconnue";
  if (value >= 1000 && value % 1000 === 0) return `${value / 1000} Gbit/s`;
  return `${value} Mbit/s`;
}

function trafficLabel(value: number | null) {
  return value === null ? "Trafic non disponible" : `${value} bit/s`;
}

function originLabel(origin: string) {
  if (origin === "INVENTORY") return "Inventaire";
  if (origin === "SIMULATION") return "Simulation";
  return "Manuel";
}

function vlanLabel(link: TopologyLink) {
  return link.vlan ? `VLAN ${link.vlan.vid}` : "sans VLAN";
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

function addInternet() {
  const site = siteId.value || sites.value?.data[0]?.id;
  if (!site) return;
  return run(() => $fetch(`/api/backend/organizations/${organizationId.value}/topology/markers`, { method: "POST", body: { siteId: site } }));
}

function endpoint(id: string) {
  const node = nodeById(id);
  if (!node) return {};
  return node.kind === "INTERNET" ? { markerId: node.id } : { deviceId: node.id };
}

function createLink() {
  return run(async () => {
    const source = endpoint(linkForm.sourceId);
    const target = endpoint(linkForm.targetId);
    await $fetch(`/api/backend/organizations/${organizationId.value}/topology/links`, {
      method: "POST",
      body: {
        ...sourceKeys(source, "source"),
        ...sourceKeys(target, "target"),
        sourcePort: linkForm.sourcePort || undefined,
        targetPort: linkForm.targetPort || undefined,
        speedMbps: linkForm.speedMbps ? Number(linkForm.speedMbps) : undefined,
        status: linkForm.status,
        vlanId: linkForm.vlanId || undefined,
        trafficBps: linkForm.trafficBps === "" ? undefined : Number(linkForm.trafficBps),
      },
    });
    linkForm.sourcePort = "";
    linkForm.targetPort = "";
    linkForm.trafficBps = "";
  });
}

function sourceKeys(endpointValue: { deviceId?: string; markerId?: string }, side: "source" | "target") {
  if (side === "source") return { sourceDeviceId: endpointValue.deviceId, sourceMarkerId: endpointValue.markerId };
  return { targetDeviceId: endpointValue.deviceId, targetMarkerId: endpointValue.markerId };
}

function remove(path: string) {
  return run(() => $fetch(path, { method: "DELETE" }));
}

function onPointerDown(event: PointerEvent, node: TopologyNode) {
  if (!canWrite.value) return;
  const current = point(node);
  drag.value = { id: node.id, kind: node.kind, startX: event.clientX, startY: event.clientY, originX: current.x, originY: current.y };
  (event.currentTarget as Element | null)?.setPointerCapture?.(event.pointerId);
}

function onPointerMove(event: PointerEvent) {
  if (!drag.value) return;
  const svg = event.currentTarget as SVGSVGElement;
  const rect = svg.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const scaleX = (1700 / zoom.value) / rect.width;
  const scaleY = (760 / zoom.value) / rect.height;
  positions[drag.value.id] = {
    x: Math.round(drag.value.originX + (event.clientX - drag.value.startX) * scaleX),
    y: Math.round(drag.value.originY + (event.clientY - drag.value.startY) * scaleY),
  };
}

async function onPointerUp() {
  const current = drag.value;
  const position = current ? positions[current.id] : null;
  drag.value = null;
  if (!current || !position || !canWrite.value) return;
  await run(async () => {
    if (current.kind === "INTERNET") {
      await $fetch(`/api/backend/topology/markers/${current.id}`, { method: "PATCH", body: position });
      return;
    }
    await $fetch(`/api/backend/organizations/${organizationId.value}/topology/placements`, {
      method: "POST",
      body: { deviceId: current.id, ...position },
    });
  });
}

function zoomBy(factor: number) {
  zoom.value = Math.min(2.4, Math.max(0.6, Math.round(zoom.value * factor * 100) / 100));
}
</script>

<template>
  <header class="page-head">
    <div>
      <h1>Topologie</h1>
      <p class="lede">{{ topology?.notice }}</p>
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
  <div class="topology-tools">
    <label>Recherche <input v-model="q" placeholder="core-paris" /></label>
    <button type="button" @click="zoomBy(1.2)">Zoom avant</button>
    <button type="button" @click="zoomBy(0.8)">Zoom arrière</button>
    <button v-if="canWrite" type="button" @click="addInternet">Ajouter Internet</button>
  </div>
  <svg class="topology-canvas" :viewBox="viewBox" @pointermove="onPointerMove" @pointerup="onPointerUp" @pointerleave="onPointerUp">
    <g v-for="link in topology?.links ?? []" :key="link.id">
      <line v-if="ends(link)" :x1="ends(link)?.x1" :y1="ends(link)?.y1" :x2="ends(link)?.x2" :y2="ends(link)?.y2" stroke="#64748b" stroke-width="2" />
      <text v-if="ends(link)" :x="((ends(link)?.x1 ?? 0) + (ends(link)?.x2 ?? 0)) / 2" :y="((ends(link)?.y1 ?? 0) + (ends(link)?.y2 ?? 0)) / 2 - 18" text-anchor="middle" font-size="12" fill="#334155">
        <tspan>{{ link.sourcePort || "—" }} → {{ link.targetPort || "—" }}</tspan>
        <tspan :x="((ends(link)?.x1 ?? 0) + (ends(link)?.x2 ?? 0)) / 2" dy="15">{{ speedLabel(link.speedMbps) }} · {{ link.status }} · {{ vlanLabel(link) }}</tspan>
        <tspan :x="((ends(link)?.x1 ?? 0) + (ends(link)?.x2 ?? 0)) / 2" dy="15">{{ trafficLabel(link.trafficBps) }} · {{ originLabel(link.origin) }}</tspan>
      </text>
    </g>
    <g v-for="node in topology?.nodes ?? []" :key="node.id" :transform="'translate(' + point(node).x + ' ' + point(node).y + ')'" :data-simulated="node.simulated ? 'true' : 'false'" @pointerdown="onPointerDown($event, node)">
      <rect width="148" height="72" rx="12" :fill="roleFill(node.simulated)" :stroke="roleStroke(node.role, node.simulated)" :stroke-width="node.simulated ? 2 : 2.5" :stroke-dasharray="node.simulated ? '5 4' : '0'" />
      <text x="74" y="28" text-anchor="middle" font-size="14" font-weight="650" fill="#0f172a">{{ node.label }}</text>
      <text x="74" y="50" text-anchor="middle" font-size="12" fill="#64748b">{{ node.simulated ? "Simulation" : roleLabel(node.role) }}</text>
    </g>
  </svg>

  <section class="panel" style="margin-top: 16px">
    <h2>Liens</h2>
    <table v-if="topology?.links.length">
      <thead>
        <tr>
          <th>Source</th>
          <th>Port source</th>
          <th>Destination</th>
          <th>Port destination</th>
          <th>Vitesse</th>
          <th>Statut</th>
          <th>VLAN</th>
          <th>Trafic</th>
          <th>Origine</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="link in topology.links" :key="link.id">
          <td>{{ nodeById(link.sourceId)?.label }}</td>
          <td>{{ link.sourcePort || "—" }}</td>
          <td>{{ nodeById(link.targetId)?.label }}</td>
          <td>{{ link.targetPort || "—" }}</td>
          <td>{{ speedLabel(link.speedMbps) }}</td>
          <td>{{ link.status }}</td>
          <td>{{ vlanLabel(link) }}</td>
          <td>{{ trafficLabel(link.trafficBps) }}</td>
          <td>{{ originLabel(link.origin) }}</td>
          <td>
            <button v-if="canDelete && !link.derived" class="ghost" type="button" @click="remove('/api/backend/topology/links/' + link.id)">Retirer</button>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else class="empty">Aucun lien.</p>
  </section>

  <section class="panel" style="margin-top: 16px">
    <h2>Découverte LLDP / CDP</h2>
    <p class="hint">{{ topology?.discoveryNotice }}</p>
    <ul v-if="topology?.discoveries.length">
      <li v-for="item in topology.discoveries" :key="item.id">{{ item.protocol }} · préparée</li>
    </ul>
    <p v-else class="empty">Aucune découverte préparée.</p>
  </section>

  <section v-if="canWrite" class="panel" style="margin-top: 16px">
    <h2>Relier</h2>
    <form class="grid" @submit.prevent="createLink">
      <label>Source
        <select v-model="linkForm.sourceId" required>
          <option value="">Choisir</option>
          <option v-for="node in topology?.nodes ?? []" :key="'s-' + node.id" :value="node.id">{{ node.label }}</option>
        </select>
      </label>
      <label>Destination
        <select v-model="linkForm.targetId" required>
          <option value="">Choisir</option>
          <option v-for="node in topology?.nodes ?? []" :key="'t-' + node.id" :value="node.id">{{ node.label }}</option>
        </select>
      </label>
      <label>Port source <input v-model="linkForm.sourcePort" placeholder="Gi0/1" /></label>
      <label>Port destination <input v-model="linkForm.targetPort" placeholder="Gi0/1" /></label>
      <label>Vitesse (Mbit/s) <input v-model="linkForm.speedMbps" inputmode="numeric" /></label>
      <label>Statut
        <select v-model="linkForm.status">
          <option value="UP">UP</option>
          <option value="DOWN">DOWN</option>
          <option value="ADMIN_DOWN">ADMIN_DOWN</option>
          <option value="UNKNOWN">UNKNOWN</option>
        </select>
      </label>
      <label>VLAN
        <select v-model="linkForm.vlanId">
          <option value="">Aucun</option>
          <option v-for="vlan in vlans?.data ?? []" :key="vlan.id" :value="vlan.id">VLAN {{ vlan.vid }} {{ vlan.name }}</option>
        </select>
      </label>
      <label>Trafic (bit/s) <input v-model="linkForm.trafficBps" inputmode="numeric" placeholder="non disponible" /></label>
      <button type="submit">Connecter</button>
    </form>
  </section>
</template>
