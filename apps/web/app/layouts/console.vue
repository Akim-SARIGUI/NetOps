<script setup lang="ts">
const { sidebarCollapsed, mobileOpen, hydrate, closeMobile } = useUiChrome();

onMounted(() => hydrate());

const shellClass = computed(() => ({
  "is-collapsed": sidebarCollapsed.value && !mobileOpen.value,
  "is-mobile-open": mobileOpen.value,
}));
</script>

<template>
  <div class="shell" :class="shellClass">
    <div class="shell-overlay" @click="closeMobile" />
    <AppSidebar />
    <div class="shell-main">
      <AppTopbar />
      <main class="content">
        <slot />
      </main>
    </div>
  </div>
</template>
