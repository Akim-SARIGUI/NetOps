<script setup lang="ts">
import type { Device, FirewallOverview, ListResponse, Organization, Site, Vlan } from "~/types/api";

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
const { data: firewall, refresh } = await useFetch<FirewallOverview>(
  () => (organizationId.value ? `/api/backend/organizations/${organizationId.value}/firewall` : null),
  { query, watch: [organizationId, query] },
);
const { data: devices } = await useFetch<ListResponse<Device>>(
  () => (organizationId.value ? `/api/backend/organizations/${organizationId.value}/devices` : null),
  { watch: [organizationId] },
);
const { data: vlans } = await useFetch<ListResponse<Vlan>>(
  () => (organizationId.value ? `/api/backend/organizations/${organizationId.value}/vlans` : null),
  { watch: [organizationId] },
);

const message = ref("");
const zoneForm = reactive({ name: "", vlanId: "" });
const flowForm = reactive({ priority: "", source: "GUEST", destination: "INTERNET", protocol: "ANY", sourcePort: "", destinationPort: "", action: "ALLOW", logging: false, enabled: true });
const aclForm = reactive({ name: "", deviceId: "" });
const ruleForm = reactive({ aclId: "", priority: "", source: "", destination: "", protocol: "TCP", sourcePort: "", destinationPort: "", action: "ALLOW", logging: false, enabled: true });
const matrixVlans = computed(() => {
  const seen = new Map<string, FirewallOverview["matrix"][number]["source"]>();
  for (const cell of firewall.value?.matrix ?? []) seen.set(cell.source.id, cell.source);
  return [...seen.values()];
});
const endpoints = computed(() => ["ANY", ...(firewall.value?.zones.map((zone) => zone.name) ?? [])]);
const firewalls = computed(() => (devices.value?.data ?? []).filter((device) => device.role === "FIREWALL"));
const alerts = computed(() => [
  ...(firewall.value?.flows.flatMap((rule) => rule.issues.map((issue) => ({ id: rule.id + issue.code, message: `${rule.source} → ${rule.destination} · ${issue.message}` }))) ?? []),
  ...(firewall.value?.acls.flatMap((acl) => acl.rules.flatMap((rule) => rule.issues.map((issue) => ({ id: rule.id + issue.code, message: `${acl.name} ${rule.source} → ${rule.destination} · ${issue.message}` })))) ?? []),
]);

watch(organizationId, () => {
  siteId.value = "";
});

function cell(sourceId: string, destinationId: string) {
  return firewall.value?.matrix.find((item) => item.source.id === sourceId && item.destination.id === destinationId);
}

function cellClass(action: string | null | undefined) {
  if (action === "ALLOW") return "allow";
  if (action === "DENY") return "deny";
  return "";
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

function createZone() {
  return run(async () => {
    await $fetch(`/api/backend/organizations/${organizationId.value}/firewall/zones`, {
      method: "POST",
      body: { name: zoneForm.name, vlanIds: zoneForm.vlanId ? [zoneForm.vlanId] : undefined },
    });
    zoneForm.name = "";
    zoneForm.vlanId = "";
  });
}

function createFlow() {
  return run(async () => {
    await $fetch(`/api/backend/organizations/${organizationId.value}/firewall/flows`, {
      method: "POST",
      body: {
        priority: Number(flowForm.priority),
        source: flowForm.source,
        destination: flowForm.destination,
        protocol: flowForm.protocol,
        sourcePort: flowForm.sourcePort || undefined,
        destinationPort: flowForm.destinationPort || undefined,
        action: flowForm.action,
        logging: flowForm.logging,
        enabled: flowForm.enabled,
      },
    });
    flowForm.priority = "";
  });
}

function createAcl() {
  return run(async () => {
    await $fetch(`/api/backend/organizations/${organizationId.value}/firewall/acls`, {
      method: "POST",
      body: { name: aclForm.name, deviceId: aclForm.deviceId || undefined },
    });
    aclForm.name = "";
  });
}

function createRule() {
  return run(async () => {
    await $fetch(`/api/backend/firewall/acls/${ruleForm.aclId}/rules`, {
      method: "POST",
      body: {
        priority: Number(ruleForm.priority),
        source: ruleForm.source,
        destination: ruleForm.destination,
        protocol: ruleForm.protocol,
        sourcePort: ruleForm.sourcePort || undefined,
        destinationPort: ruleForm.destinationPort || undefined,
        action: ruleForm.action,
        logging: ruleForm.logging,
        enabled: ruleForm.enabled,
      },
    });
    ruleForm.priority = "";
    ruleForm.source = "";
    ruleForm.destination = "";
  });
}

function remove(path: string) {
  return run(() => $fetch(path, { method: "DELETE" }));
}
</script>

<template>
  <header class="page-head">
    <div>
      <h1>Pare-feu</h1>
      <p class="lede">{{ firewall?.notice }}</p>
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
    <article class="metric"><span>Zones</span><strong>{{ firewall?.totals.zones ?? 0 }}</strong></article>
    <article class="metric"><span>Flux</span><strong>{{ firewall?.totals.flows ?? 0 }}</strong></article>
    <article class="metric"><span>ACL</span><strong>{{ firewall?.totals.acls ?? 0 }}</strong></article>
    <article class="metric"><span>Alertes</span><strong>{{ firewall?.totals.alerts ?? 0 }}</strong></article>
  </div>

  <section class="panel" style="margin-bottom: 16px">
    <h2>Matrice des flux</h2>
    <p class="hint">Chaque case est le flux entre les zones des VLAN. Sans règle, le flux est refusé.</p>
    <table v-if="matrixVlans.length">
      <thead>
        <tr>
          <th>Source</th>
          <th v-for="vlan in matrixVlans" :key="vlan.id">VLAN {{ vlan.vid }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="source in matrixVlans" :key="source.id">
          <th>VLAN {{ source.vid }} <span v-if="source.zone">{{ source.zone }}</span></th>
          <td v-for="destination in matrixVlans" :key="source.id + '-' + destination.id" :class="cellClass(cell(source.id, destination.id)?.action)" :title="cell(source.id, destination.id)?.implicit ? 'Refus implicite' : (source.zone || '') + ' → ' + (destination.zone || '')">
            {{ cell(source.id, destination.id)?.action || "—" }}
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else class="empty">Aucun VLAN à comparer.</p>
  </section>

  <section class="panel" style="margin-bottom: 16px">
    <h2>Zones de sécurité</h2>
    <ul v-if="firewall?.zones.length">
      <li v-for="zone in firewall.zones" :key="zone.id">
        <strong>{{ zone.name }}</strong>
        <span v-if="zone.vlans.length"> · {{ zone.vlans.map((vlan) => 'VLAN ' + vlan.vid + ' ' + vlan.name).join(', ') }}</span>
        <span v-else> · aucun VLAN</span>
        <button v-if="canDelete" class="ghost" type="button" @click="remove('/api/backend/firewall/zones/' + zone.id)">Retirer</button>
      </li>
    </ul>
    <p v-else class="empty">Aucune zone.</p>
  </section>

  <section class="panel" style="margin-bottom: 16px">
    <h2>Règles de flux</h2>
    <table v-if="firewall?.flows.length">
      <thead>
        <tr>
          <th>Priorité</th>
          <th>Source</th>
          <th>Destination</th>
          <th>Protocole</th>
          <th>Port source</th>
          <th>Port destination</th>
          <th>Action</th>
          <th>Journal</th>
          <th>Active</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="rule in firewall.flows" :key="rule.id">
          <td>{{ rule.priority }}</td>
          <td>{{ rule.source }}</td>
          <td>{{ rule.destination }}</td>
          <td>{{ rule.protocol }}</td>
          <td>{{ rule.sourcePort || "—" }}</td>
          <td>{{ rule.destinationPort || "—" }}</td>
          <td :class="cellClass(rule.action)">{{ rule.action }}</td>
          <td>{{ rule.logging ? "Oui" : "Non" }}</td>
          <td>{{ rule.enabled ? "Oui" : "Non" }}</td>
          <td><button v-if="canDelete" class="ghost" type="button" @click="remove('/api/backend/firewall/flows/' + rule.id)">Retirer</button></td>
        </tr>
      </tbody>
    </table>
    <p v-else class="empty">Aucune règle de flux.</p>
  </section>

  <section class="panel" style="margin-bottom: 16px">
    <h2>Alertes</h2>
    <ul v-if="alerts.length">
      <li v-for="alert in alerts" :key="alert.id">{{ alert.message }}</li>
    </ul>
    <p v-else class="empty">Aucune alerte.</p>
  </section>

  <section v-for="acl in firewall?.acls ?? []" :key="acl.id" class="panel" style="margin-bottom: 16px">
    <h2>ACL {{ acl.name }}</h2>
    <p class="hint">{{ acl.device ? acl.device.hostname : "Sans équipement" }} · {{ acl.status === 'PLANNED' ? 'Prévue' : acl.status }}. {{ firewall?.notice }}</p>
    <table v-if="acl.rules.length">
      <thead>
        <tr>
          <th>Priorité</th>
          <th>Source</th>
          <th>Destination</th>
          <th>Protocole</th>
          <th>Port source</th>
          <th>Port destination</th>
          <th>Action</th>
          <th>Journal</th>
          <th>Active</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="rule in acl.rules" :key="rule.id">
          <td>{{ rule.priority }}</td>
          <td class="mono">{{ rule.source }}</td>
          <td class="mono">{{ rule.destination }}</td>
          <td>{{ rule.protocol }}</td>
          <td>{{ rule.sourcePort || "—" }}</td>
          <td>{{ rule.destinationPort || "—" }}</td>
          <td :class="cellClass(rule.action)">{{ rule.action }}</td>
          <td>{{ rule.logging ? "Oui" : "Non" }}</td>
          <td>{{ rule.enabled ? "Oui" : "Non" }}</td>
          <td><button v-if="canDelete" class="ghost" type="button" @click="remove('/api/backend/firewall/rules/' + rule.id)">Retirer</button></td>
        </tr>
      </tbody>
    </table>
    <p v-else class="empty">Aucune règle.</p>
    <button v-if="canDelete" class="ghost" type="button" @click="remove('/api/backend/firewall/acls/' + acl.id)">Retirer l'ACL</button>
  </section>

  <template v-if="canWrite">
    <section class="panel" style="margin-bottom: 16px">
      <h2>Nouvelle zone</h2>
      <form class="grid" @submit.prevent="createZone">
        <label>Nom <input v-model="zoneForm.name" required placeholder="GUEST" /></label>
        <label>VLAN
          <select v-model="zoneForm.vlanId">
            <option value="">Aucun</option>
            <option v-for="vlan in vlans?.data ?? []" :key="vlan.id" :value="vlan.id">VLAN {{ vlan.vid }} {{ vlan.name }}</option>
          </select>
        </label>
        <button type="submit">Ajouter la zone</button>
      </form>
    </section>
    <section class="panel" style="margin-bottom: 16px">
      <h2>Nouveau flux</h2>
      <form class="grid" @submit.prevent="createFlow">
        <label>Priorité <input v-model="flowForm.priority" required inputmode="numeric" /></label>
        <label>Source
          <select v-model="flowForm.source">
            <option v-for="endpoint in endpoints" :key="'s-' + endpoint" :value="endpoint">{{ endpoint }}</option>
          </select>
        </label>
        <label>Destination
          <select v-model="flowForm.destination">
            <option v-for="endpoint in endpoints" :key="'d-' + endpoint" :value="endpoint">{{ endpoint }}</option>
          </select>
        </label>
        <label>Protocole
          <select v-model="flowForm.protocol">
            <option value="ANY">ANY</option>
            <option value="TCP">TCP</option>
            <option value="UDP">UDP</option>
            <option value="ICMP">ICMP</option>
          </select>
        </label>
        <label>Port source <input v-model="flowForm.sourcePort" placeholder="—" /></label>
        <label>Port destination <input v-model="flowForm.destinationPort" placeholder="443" /></label>
        <label>Action
          <select v-model="flowForm.action">
            <option value="ALLOW">ALLOW</option>
            <option value="DENY">DENY</option>
          </select>
        </label>
        <label><input v-model="flowForm.logging" type="checkbox" /> Journaliser</label>
        <label><input v-model="flowForm.enabled" type="checkbox" /> Active</label>
        <button type="submit">Ajouter le flux</button>
      </form>
    </section>
    <section class="panel" style="margin-bottom: 16px">
      <h2>Nouvelle ACL</h2>
      <form class="grid" @submit.prevent="createAcl">
        <label>Nom <input v-model="aclForm.name" required placeholder="bordure" /></label>
        <label>Pare-feu
          <select v-model="aclForm.deviceId">
            <option value="">Aucun</option>
            <option v-for="device in firewalls" :key="device.id" :value="device.id">{{ device.hostname }}</option>
          </select>
        </label>
        <button type="submit">Ajouter l'ACL</button>
      </form>
    </section>
    <section class="panel">
      <h2>Nouvelle règle</h2>
      <form class="grid" @submit.prevent="createRule">
        <label>ACL
          <select v-model="ruleForm.aclId" required>
            <option value="">Choisir</option>
            <option v-for="acl in firewall?.acls ?? []" :key="acl.id" :value="acl.id">{{ acl.name }}</option>
          </select>
        </label>
        <label>Priorité <input v-model="ruleForm.priority" required inputmode="numeric" /></label>
        <label>Source <input v-model="ruleForm.source" required placeholder="10.1.10.0/24" /></label>
        <label>Destination <input v-model="ruleForm.destination" required placeholder="10.1.30.0/24" /></label>
        <label>Protocole
          <select v-model="ruleForm.protocol">
            <option value="ANY">ANY</option>
            <option value="TCP">TCP</option>
            <option value="UDP">UDP</option>
            <option value="ICMP">ICMP</option>
          </select>
        </label>
        <label>Port source <input v-model="ruleForm.sourcePort" /></label>
        <label>Port destination <input v-model="ruleForm.destinationPort" placeholder="443" /></label>
        <label>Action
          <select v-model="ruleForm.action">
            <option value="ALLOW">ALLOW</option>
            <option value="DENY">DENY</option>
          </select>
        </label>
        <label><input v-model="ruleForm.logging" type="checkbox" /> Journaliser</label>
        <label><input v-model="ruleForm.enabled" type="checkbox" /> Active</label>
        <button type="submit">Ajouter la règle</button>
      </form>
    </section>
  </template>
</template>
