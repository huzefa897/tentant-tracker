<script setup lang="ts">
import { onMounted, useTemplateRef } from 'vue'
import { useRouter } from 'vue-router'

import PhoneNumberForm from '@/components/auth/PhoneNumberForm.vue'
import AuthLayout from '@/layouts/AuthLayout.vue'
import { useAuthStore } from '@/stores/auth'

const authStore = useAuthStore()
const router = useRouter()
// Firebase's invisible reCAPTCHA renders here (see authService.sendOtp).
const recaptchaHost = useTemplateRef<HTMLElement>('recaptcha-host')

onMounted(() => {
  authStore.clearError()
})

async function handleSubmit(phoneNumber: string) {
  if (!recaptchaHost.value) return

  try {
    await authStore.sendOtp(phoneNumber, recaptchaHost.value)
    await router.push({ name: 'verify' })
  } catch {
    // authStore.error is shown by the form
  }
}
</script>

<template>
  <AuthLayout>
    <header class="mb-8 text-center">
      <h1 class="text-3xl font-bold tracking-tight sm:text-4xl">Welcome back</h1>
      <p class="mt-2 text-muted-foreground">Manage your rental properties and rent entries</p>
    </header>

    <p
      v-if="authStore.loginNotice"
      class="mb-6 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
      role="alert"
    >
      {{ authStore.loginNotice }}
    </p>

    <PhoneNumberForm :loading="authStore.loading" :error="authStore.error" @submit="handleSubmit" />
    <div ref="recaptcha-host" />

    <p class="mt-6 text-center text-sm text-muted-foreground">
      We'll send a verification code to your phone.
    </p>
  </AuthLayout>
</template>
