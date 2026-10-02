<script setup lang="ts">
defineProps<{
  title: string;
  description?: string;
  actionLabel?: string;
}>();

const emit = defineEmits<{ action: [] }>();
</script>

<template>
  <div class="empty-state">
    <AppIcon name="empty" :size="28" />
    <h3>{{ title }}</h3>
    <p v-if="description">{{ description }}</p>
    <AppButton v-if="actionLabel" variant="primary" type="button" @click="emit('action')">{{ actionLabel }}</AppButton>
  </div>
</template>
