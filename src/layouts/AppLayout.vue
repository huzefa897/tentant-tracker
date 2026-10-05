<script setup lang="ts">
import AppLogo from '@/components/brand/AppLogo.vue'
import WaveBackground from '@/components/brand/WaveBackground.vue'
</script>

<!-- The card fills the screen, leaving a thin strip of backdrop so it still reads as floating; it
     stops growing at 1800px so tables stay readable on very wide monitors. -->
<template>
  <main class="relative min-h-dvh overflow-hidden bg-[#020f2e] p-3 sm:p-5 lg:p-6">
    <WaveBackground />

    <div
      class="relative mx-auto flex min-h-[calc(100dvh-1.5rem)] w-full max-w-[1800px] flex-col rounded-2xl bg-card text-card-foreground shadow-2xl shadow-black/30 sm:min-h-[calc(100dvh-2.5rem)] lg:min-h-[calc(100dvh-3rem)]"
      data-testid="app-card"
    >
      <header
        class="flex flex-wrap items-center justify-between gap-4 border-b px-6 py-5 sm:px-10 lg:px-12"
        data-testid="app-header"
      >
        <AppLogo />
        <slot name="header-actions" />
      </header>

      <!-- Each screen mounts its own layout, so the content eases in on every screen change. -->
      <div
        class="flex-1 animate-page-in px-6 py-8 sm:px-10 lg:px-12 lg:py-10"
        data-testid="app-content"
      >
        <slot />
      </div>
    </div>
  </main>
</template>
