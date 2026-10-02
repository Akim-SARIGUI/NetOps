<script setup lang="ts">
withDefaults(
  defineProps<{
    variant?: "primary" | "secondary" | "ghost" | "danger";
    type?: "button" | "submit" | "reset";
    disabled?: boolean;
    loading?: boolean;
  }>(),
  { variant: "primary", type: "button", disabled: false, loading: false },
);
</script>

<template>
  <button
    :type="type"
    class="btn"
    :class="{
      'btn-primary': variant === 'primary',
      'btn-secondary': variant === 'secondary',
      'btn-ghost in-content': variant === 'ghost',
      'btn-danger': variant === 'danger',
    }"
    :disabled="disabled || loading"
  >
    <slot />
  </button>
</template>
