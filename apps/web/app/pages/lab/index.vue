<script setup lang="ts">
import type { LabFabricView, LabOverview, Organization, ListResponse } from "~/types/api";

definePageMeta({ layout: "console", middleware: "auth" });

const session = useSession();
const { data: organizations } = await useFetch<ListResponse<Organization>>("/api/backend/organizations");
const organizationId = ref(organizations.value?.data[0]?.id ?? "");
const canWrite = computed(() => can(session.value, organizationId.value, "inventory:write"));
const { data: lab, refresh } = await useFetch<LabOverview>(
  () => (organizationId.value ? `/api/backend/organizations/${organizationId.value}/lab` : null),
  { watch: [organizationId] },
);

const message = ref("");
const siteId = ref("");
const targetSiteId = ref("");
const sourcePromotionId = ref("");
const selectedId = ref("");

const fabric = computed<LabFabricView | null>(() => {
  const fabrics = lab.value?.fabrics ?? [];
  return fabrics.find((item) => item.id === selectedId.value) ?? fabrics[0] ?? null;
});
const labSites = computed(() => (lab.value?.sites ?? []).filter((site) => site.environment === "LAB"));
const stagingSites = computed(() => (lab.value?.sites ?? []).filter((site) => site.environment === "STAGING"));
const productionSites = computed(() => (lab.value?.sites ?? []).filter((site) => site.environment === "PRODUCTION"));
const stagingPromotion = computed(() => fabric.value?.promotions.find((item) => item.targetEnvironment === "STAGING" && item.phase === "PROMOTED") ?? null);
const activePromotion = computed(() => fabric.value?.promotions[0] ?? null);

watch(lab, (value) => {
  if (!selectedId.value && value?.fabrics[0]) selectedId.value = value.fabrics[0].id;
  if (!siteId.value) siteId.value = value?.sites.find((site) => site.environment === "LAB")?.id ?? "";
  if (!targetSiteId.value) targetSiteId.value = value?.sites.find((site) => site.environment === "STAGING")?.id ?? "";
}, { immediate: true });

async function run(task: () => Promise<void>) {
  message.value = "";
  try {
    await task();
    await refresh();
  } catch (error) {
    message.value = apiErrorMessage(error);
  }
}

function createFabric() {
  return run(async () => {
    const created = await $fetch<{ id: string }>(`/api/backend/organizations/${organizationId.value}/lab`, {
      method: "POST",
      body: { siteId: siteId.value },
    });
    selectedId.value = created.id;
  });
}

function prepare() {
  if (!fabric.value) return;
  const body: { targetSiteId: string; sourcePromotionId?: string } = { targetSiteId: targetSiteId.value };
  if (sourcePromotionId.value) body.sourcePromotionId = sourcePromotionId.value;
  return run(() => $fetch(`/api/backend/lab/${fabric.value!.id}/promotions`, { method: "POST", body }));
}

function validate() {
  const promotion = activePromotion.value;
  if (!promotion) return;
  return run(() => $fetch(`/api/backend/lab/promotions/${promotion.id}/validate`, { method: "POST" }));
}

function promote() {
  const promotion = activePromotion.value;
  if (!promotion) return;
  const body = { confirmProduction: promotion.targetEnvironment === "PRODUCTION" };
  return run(() => $fetch(`/api/backend/lab/promotions/${promotion.id}/promote`, { method: "POST", body }));
}

function prepareProduction() {
  if (!fabric.value || !stagingPromotion.value) return;
  sourcePromotionId.value = stagingPromotion.value.id;
  targetSiteId.value = productionSites.value[0]?.id ?? "";
  return prepare();
}
</script>

<template>
  <header class="page-head">
    <div>
      <h1>Laboratoire</h1>
      <p class="lede">{{ lab?.notice }}</p>
    </div>
  </header>
  <p v-if="message" class="banner">{{ message }}</p>
  <p>{{ lab?.promotionNotice }}</p>
  <p>
    <template v-for="(environment, index) in lab?.environments ?? []" :key="environment.id">
      <span>{{ environment.id }}</span>
      <span v-if="index < (lab?.environments.length ?? 0) - 1"> → </span>
    </template>
  </p>
  <p>Promotion autorisée : LAB → STAGING → PRODUCTION.</p>

  <section v-if="canWrite && !(lab?.fabrics.length)" class="panel" style="margin: 16px 0">
    <h2>Créer une fabrique isolée</h2>
    <form class="grid" @submit.prevent="createFabric">
      <label>Site LAB
        <select v-model="siteId" required>
          <option value="">Choisir</option>
          <option v-for="site in labSites" :key="site.id" :value="site.id">{{ site.name }} · {{ site.code }}</option>
        </select>
      </label>
      <button type="submit">Créer la fabrique</button>
    </form>
  </section>

  <section class="panel">
    <h2>{{ fabric ? fabric.site.name : "Aucune fabrique" }}</h2>
    <template v-if="fabric">
      <h3>Infrastructure</h3>
      <ul>
        <li v-for="node in fabric.nodes" :key="node.id">{{ node.role }} · {{ node.hostname }} · {{ node.address }}</li>
      </ul>
      <h3>Scénarios</h3>
      <article v-for="item in fabric.scenarios" :key="item.id" style="margin-top: 12px">
        <h4>{{ item.label }}</h4>
        <p>{{ item.plan }}</p>
        <p>{{ item.observation }}</p>
      </article>
      <h3>Promotions</h3>
      <p v-if="!fabric.promotions.length" class="empty">Aucune promotion.</p>
      <article v-for="item in fabric.promotions" :key="item.id" style="margin-top: 12px">
        <p>{{ item.sourceEnvironment }} → {{ item.targetEnvironment }} · {{ item.phase }} · {{ item.targetSite.name }}</p>
        <p>applied={{ item.applied }} · pushed={{ item.pushed }}</p>
        <pre>{{ item.configuration }}</pre>
      </article>
      <div v-if="canWrite" class="grid" style="margin-top: 16px">
        <label>Cible
          <select v-model="targetSiteId">
            <option v-for="site in [...stagingSites, ...productionSites]" :key="site.id" :value="site.id">{{ site.name }} · {{ site.environment }}</option>
          </select>
        </label>
        <button v-if="!activePromotion || activePromotion.phase === 'PROMOTED'" type="button" @click="prepare">Préparer la promotion</button>
        <button v-if="activePromotion?.phase === 'PREPARED'" type="button" @click="validate">Valider</button>
        <button v-if="activePromotion?.phase === 'VALIDATED'" type="button" @click="promote">Promouvoir</button>
        <button v-if="stagingPromotion && !fabric.promotions.some((item) => item.targetEnvironment === 'PRODUCTION')" type="button" @click="prepareProduction">Préparer PRODUCTION</button>
      </div>
    </template>
  </section>
</template>
