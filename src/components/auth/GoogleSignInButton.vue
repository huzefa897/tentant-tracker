<script setup lang="ts">
import { PhSpinnerGap } from '@phosphor-icons/vue'

import GoogleLogo from '@/components/brand/GoogleLogo.vue'
import { Button } from '@/components/ui/button'

defineProps<{
  loading: boolean
  error: string | null
}>()

const emit = defineEmits<{
  signIn: []
}>()
</script>

<template>
  <div class="space-y-3">
    <!-- Emits straight from the click: browsers block popups opened later. -->
    <Button
      type="button"
      variant="outline"
      class="relative h-12 w-full gap-3 text-base"
      :disabled="loading"
      :aria-busy="loading"
      :aria-describedby="error ? 'sign-in-error' : undefined"
      @click="emit('signIn')"
    >
      <PhSpinnerGap v-if="loading" class="size-5! animate-spin" aria-hidden="true" />
      <GoogleLogo v-else class="size-5!" />
      {{ loading ? 'Signing in…' : 'Continue with Google' }}
    </Button>

    <p v-if="error" id="sign-in-error" class="text-center text-sm text-destructive" role="alert">
      {{ error }}
    </p>
  </div>
</template>
