<script setup lang="ts">
import AppLogo from '@/components/brand/AppLogo.vue'
import WaveBackground from '@/components/brand/WaveBackground.vue'
</script>

<template>
  <main class="relative min-h-screen overflow-hidden bg-[#020f2e] p-4 sm:p-8 lg:py-16">
    <WaveBackground />

    <div
      class="relative mx-auto w-full max-w-5xl rounded-2xl bg-card text-card-foreground shadow-2xl shadow-black/30"
    >
      <header class="flex flex-wrap items-center justify-between gap-4 border-b px-6 py-5 sm:px-10">
        <AppLogo />
        <slot name="header-actions" />
      </header>

      <div class="px-6 py-8 sm:px-10">
        <slot />
      </div>
    </div>
  </main>
</template>
