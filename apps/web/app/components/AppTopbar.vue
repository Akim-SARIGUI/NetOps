<script setup lang="ts">
import { NAV_GROUPS, pageTitleForPath } from "~/utils/navigation";

const session = useSession();
const route = useRoute();
const { theme, toggleTheme, toggleSidebar } = useUiChrome();

const query = ref("");
const showSearch = ref(false);
const showNotif = ref(false);
const showProfile = ref(false);

const title = computed(() => pageTitleForPath(route.path));
const initials = computed(() => {
  const name = session.value?.user.name?.trim() || "?";
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("");
});

const results = computed(() => {
  const needle = query.value.trim().toLowerCase();
  if (!needle) return [];
  return NAV_GROUPS.flatMap((group) => group.items)
    .filter((item) => !item.auditOnly || canAudit(session.value))
    .filter((item) => item.label.toLowerCase().includes(needle) || item.to.includes(needle))
    .slice(0, 8);
});

async function logout() {
  await $fetch("/api/auth/logout", { method: "POST" });
  session.value = null;
  await navigateTo("/login");
}

function closeMenus() {
  showSearch.value = false;
  showNotif.value = false;
  showProfile.value = false;
}

watch(() => route.fullPath, closeMenus);
</script>

<template>
  <header class="topbar">
    <button class="icon-btn" type="button" aria-label="Basculer la navigation" @click="toggleSidebar">
      <AppIcon name="menu" />
    </button>
    <h1 class="topbar-title">{{ title }}</h1>
    <div class="topbar-spacer" />

    <div class="topbar-search">
      <span class="topbar-search-icon"><AppIcon name="search" :size="16" /></span>
      <input
        v-model="query"
        type="search"
        placeholder="Rechercher une page…"
        aria-label="Recherche"
        @focus="showSearch = true"
        @blur="showSearch = false"
      />
      <div v-if="showSearch && results.length" class="dropdown-panel search-results">
        <NuxtLink v-for="item in results" :key="item.to" :to="item.to" @mousedown.prevent="navigateTo(item.to)">
          <AppIcon :name="item.icon" :size="16" />
          <span>{{ item.label }}</span>
        </NuxtLink>
      </div>
      <div v-else-if="showSearch && query.trim()" class="dropdown-panel search-results">
        <p class="hint" style="margin: 8px">Aucun résultat.</p>
      </div>
    </div>

    <div class="topbar-actions">
      <button class="icon-btn" type="button" :aria-label="theme === 'dark' ? 'Mode clair' : 'Mode sombre'" @click="toggleTheme">
        <AppIcon :name="theme === 'dark' ? 'sun' : 'moon'" />
      </button>

      <div style="position: relative">
        <button class="icon-btn" type="button" aria-label="Notifications" @click="showNotif = !showNotif; showProfile = false">
          <AppIcon name="bell" />
        </button>
        <div v-if="showNotif" class="dropdown-panel">
          <p class="hint" style="margin: 8px">Aucune notification.</p>
        </div>
      </div>

      <div style="position: relative">
        <button class="avatar-chip" type="button" @click="showProfile = !showProfile; showNotif = false">
          <span class="avatar-circle">{{ initials }}</span>
          <span class="avatar-meta">
            <strong>{{ session?.user.name }}</strong>
            <span>{{ roleLabel(session) }}</span>
          </span>
        </button>
        <div v-if="showProfile" class="dropdown-panel">
          <button class="menu-item" type="button" @click="logout">
            <AppIcon name="logout" :size="16" />
            Se déconnecter
          </button>
        </div>
      </div>
    </div>
  </header>
</template>
