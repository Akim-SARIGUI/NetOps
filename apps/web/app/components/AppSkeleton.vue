<script setup lang="ts">
withDefaults(defineProps<{ height?: string; width?: string }>(), {
  height: "14px",
  width: "100%",
});
</script>

<template>
  <div class="skeleton" :style="{ height, width }" />
</template>
