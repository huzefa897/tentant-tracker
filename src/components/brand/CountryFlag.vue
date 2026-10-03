<!-- Inline flags: emoji flags render as "IN" on Windows. Simplified to read at 24×16. -->
<script setup lang="ts">
import type { PhoneCountryCode } from '@/utils/phoneCountries'

defineProps<{
  code: PhoneCountryCode
}>()
</script>

<template>
  <svg
    viewBox="0 0 30 20"
    class="h-4 w-6 shrink-0 overflow-hidden rounded-[3px]"
    aria-hidden="true"
    :data-flag="code"
  >
    <template v-if="code === 'IN'">
      <rect width="30" height="20" fill="#fff" />
      <rect width="30" height="6.67" fill="#ff9933" />
      <rect y="13.33" width="30" height="6.67" fill="#138808" />
      <circle cx="15" cy="10" r="2.3" fill="none" stroke="#000080" stroke-width="0.6" />
      <circle cx="15" cy="10" r="0.5" fill="#000080" />
    </template>

    <template v-else-if="code === 'AU'">
      <rect width="30" height="20" fill="#012169" />
      <path d="M0 0L15 10M15 0L0 10" stroke="#fff" stroke-width="2" />
      <path d="M0 0L15 10M15 0L0 10" stroke="#c8102e" stroke-width="0.8" />
      <path d="M7.5 0V10M0 5H15" stroke="#fff" stroke-width="3" />
      <path d="M7.5 0V10M0 5H15" stroke="#c8102e" stroke-width="1.6" />
      <g fill="#fff">
        <circle cx="7.5" cy="15" r="1.6" />
        <circle cx="22.5" cy="4" r="0.9" />
        <circle cx="19" cy="9" r="0.9" />
        <circle cx="26" cy="8" r="0.9" />
        <circle cx="22.5" cy="16" r="1" />
      </g>
    </template>

    <template v-else-if="code === 'US'">
      <rect width="30" height="20" fill="#fff" />
      <path
        d="M0 0H30M0 3.08H30M0 6.15H30M0 9.23H30M0 12.31H30M0 15.38H30M0 18.46H30"
        stroke="#b22234"
        stroke-width="1.54"
        transform="translate(0 0.77)"
      />
      <rect width="12" height="10.77" fill="#3c3b6e" />
    </template>
  </svg>
</template>
