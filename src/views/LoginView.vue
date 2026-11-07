<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'

import GoogleSignInButton from '@/components/auth/GoogleSignInButton.vue'
import AuthLayout from '@/layouts/AuthLayout.vue'
import { useAuthStore } from '@/stores/auth'

const authStore = useAuthStore()
const router = useRouter()

onMounted(() => {
  authStore.clearError()
})

async function handleSignIn() {
  try {
    await authStore.signInWithGoogle()
  } catch {
    // authStore.error is shown under the button
    return
  }

  // Not signed in when the person closed Google's window.
  if (authStore.isAuthenticated) {
    await router.replace({ name: 'dashboard' })
  }
}
</script>

<template>
  <AuthLayout>
    <header class="mb-8 text-center">
      <h1 class="text-3xl font-bold tracking-tight sm:text-4xl">Welcome back</h1>
      <p class="mt-2 text-muted-foreground">Manage your rental properties and rent bills</p>
    </header>

    <p
      v-if="authStore.loginNotice"
      class="mb-6 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
      role="alert"
    >
      {{ authStore.loginNotice }}
    </p>

    <GoogleSignInButton
      :loading="authStore.loading"
      :error="authStore.error"
      @sign-in="handleSignIn"
    />

    <p class="mt-6 text-center text-sm text-muted-foreground">
      Sign in with the Google account the property owner added.
    </p>
  </AuthLayout>
</template>
