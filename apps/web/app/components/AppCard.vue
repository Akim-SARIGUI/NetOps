<script setup lang="ts">
defineProps<{
  label?: string;
  value?: string | number;
  footnote?: string;
}>();
</script>

<template>
  <article class="card">
    <slot>
      <div v-if="label" class="card-label">{{ label }}</div>
      <strong v-if="value !== undefined" class="card-value">{{ value }}</strong>
      <p v-if="footnote" class="card-footnote">{{ footnote }}</p>
    </slot>
  </article>
</template>
