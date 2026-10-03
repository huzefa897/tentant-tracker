<script setup lang="ts">
import AppLogo from '@/components/brand/AppLogo.vue'
import WaveBackground from '@/components/brand/WaveBackground.vue'
</script>

<template>
  <main
    class="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#020f2e] p-4"
  >
    <WaveBackground />

    <section
      class="relative w-full max-w-[520px] rounded-2xl bg-card px-6 py-10 text-card-foreground shadow-2xl shadow-black/30 sm:px-10"
    >
      <slot name="corner" />

      <div class="mb-8 flex justify-center">
        <AppLogo />
      </div>

      <slot />
    </section>
  </main>
</template>
