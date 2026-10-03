<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/stores/app'

const appStore = useAppStore()
</script>

<template>
  <main class="min-h-screen bg-background text-foreground">
    <div class="mx-auto max-w-5xl p-8">
      <h1 class="text-3xl font-semibold">
        {{ appStore.appName }}
      </h1>

      <p class="mt-2 text-muted-foreground">Frontend foundation is running.</p>

      <Button class="mt-6"> UI Working </Button>
    </div>
  </main>
</template>
