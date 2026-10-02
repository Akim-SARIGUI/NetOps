<script setup lang="ts">
withDefaults(
  defineProps<{
    tone?: "neutral" | "success" | "warning" | "danger" | "info" | "violet" | "cyan";
    label: string;
  }>(),
  { tone: "neutral" },
);
</script>

<template>
  <span class="badge" :class="tone === 'neutral' ? '' : tone">{{ label }}</span>
</template>
