<script setup lang="ts">
import { Button } from '@/components/ui/button'

// Local development only: LoginView shows it when dev login is on (never in a production build).
defineProps<{
  email: string
}>()

const emit = defineEmits<{
  signIn: []
}>()
</script>

<template>
  <!-- data-dev-login-only: the marker scripts/check-no-dev-login.sh looks for in a build. -->
  <div data-dev-login-only class="mt-4 space-y-2 border-t border-dashed pt-4 text-center">
    <Button type="button" variant="secondary" class="h-11 w-full" @click="emit('signIn')">
      Dev sign-in as {{ email }}
    </Button>
    <p class="text-xs text-muted-foreground">
      Local development only. Skips Google; the backend needs DJANGO_ENV=dev.
    </p>
  </div>
</template>
