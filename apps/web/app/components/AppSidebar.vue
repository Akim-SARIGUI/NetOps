<script setup lang="ts">
import { NAV_GROUPS, isNavActive } from "~/utils/navigation";

const session = useSession();
const route = useRoute();
const { openGroups, sidebarCollapsed, mobileOpen, toggleGroup, closeMobile } = useUiChrome();
const showAudit = computed(() => canAudit(session.value));

const { data: health } = await useFetch<{ web?: string; api?: { status?: string; database?: string } }>("/api/health", {
  server: false,
  default: () => null,
});

const systemOk = computed(() => health.value?.web === "ok" && health.value?.api?.status === "ok");
const systemLabel = computed(() => {
  if (!health.value) return "Statut indisponible";
  if (systemOk.value) return "Systèmes opérationnels";
  return "Incident détecté";
});

const groups = computed(() =>
  NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.auditOnly || showAudit.value),
  })).filter((group) => group.items.length > 0),
);

const iconRail = computed(() => sidebarCollapsed.value && !mobileOpen.value);
const flatItems = computed(() => groups.value.flatMap((group) => group.items));

function active(item: (typeof NAV_GROUPS)[number]["items"][number]) {
  return isNavActive(route.path, item);
}

function onNavigate() {
  closeMobile();
}
</script>

<template>
  <aside class="rail" aria-label="Navigation principale">
    <div class="sidebar-header">
      <div class="brand-mark" aria-hidden="true">
        <AppIcon name="network" :size="18" />
      </div>
      <div class="brand">
        <strong>NetOps</strong>
        <span>Infrastructure</span>
      </div>
    </div>

    <div class="sidebar-scroll">
      <template v-if="iconRail">
        <NuxtLink
          v-for="item in flatItems"
          :key="item.to"
          :to="item.to"
          class="nav-link tooltip-host"
          :class="{ 'is-active': active(item) }"
          :data-tip="item.label"
          @click="onNavigate"
        >
          <AppIcon :name="item.icon" :size="18" />
          <span class="nav-label">{{ item.label }}</span>
        </NuxtLink>
      </template>
      <template v-else>
        <div
          v-for="group in groups"
          :key="group.id"
          class="nav-group"
          :class="{ 'is-open': openGroups[group.id] }"
        >
          <button
            type="button"
            class="nav-group-toggle"
            :aria-expanded="openGroups[group.id]"
            @click="toggleGroup(group.id)"
          >
            <AppIcon :name="group.icon" :size="18" />
            <span class="nav-group-title">{{ group.label }}</span>
            <span class="nav-chevron"><AppIcon name="chevron" :size="14" /></span>
          </button>
          <div class="nav-children">
            <div>
              <NuxtLink
                v-for="item in group.items"
                :key="item.to"
                :to="item.to"
                class="nav-link"
                :class="{ 'is-active': active(item) }"
                @click="onNavigate"
              >
                <AppIcon :name="item.icon" :size="18" />
                <span class="nav-label">{{ item.label }}</span>
              </NuxtLink>
            </div>
          </div>
        </div>
      </template>
    </div>

    <div class="sidebar-footer">
      <div class="system-status">
        <span class="system-dot" :class="systemOk ? 'is-ok' : health ? 'is-bad' : ''" />
        <span class="sidebar-footer-copy">{{ systemLabel }}</span>
      </div>
      <div class="sidebar-version sidebar-footer-copy">v1.0.0</div>
    </div>
  </aside>
</template>
