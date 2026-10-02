<script setup lang="ts">
defineProps<{ items: Array<{ label: string; to?: string }> }>();
</script>

<template>
  <nav class="crumbs">
    <NuxtLink to="/">Organisations</NuxtLink>
    <template v-for="item in items" :key="item.label">
      <span>/</span>
      <NuxtLink v-if="item.to" :to="item.to">{{ item.label }}</NuxtLink>
      <span v-else>{{ item.label }}</span>
    </template>
  </nav>
</template>
