<script setup lang="ts">
// Wraps a skeleton: screen readers hear the label once, and the placeholder shapes, which mean
// nothing to them, are hidden. Skeletons take the space the content will, so nothing moves when
// it arrives.
defineProps<{
  label: string
}>()
</script>

<template>
  <div role="status" aria-busy="true">
    <span class="sr-only">{{ label }}</span>
    <div aria-hidden="true">
      <slot />
    </div>
  </div>
</template>
