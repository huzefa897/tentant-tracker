<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'

import PhoneNumberForm from '@/components/auth/PhoneNumberForm.vue'
import AuthLayout from '@/layouts/AuthLayout.vue'
import { useAuthStore } from '@/stores/auth'

const authStore = useAuthStore()
const router = useRouter()

onMounted(() => {
  authStore.clearError()
})

async function handleSubmit(phoneNumber: string) {
  try {
    await authStore.sendOtp(phoneNumber)
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

    <PhoneNumberForm :loading="authStore.loading" :error="authStore.error" @submit="handleSubmit" />

    <p class="mt-6 text-center text-sm text-muted-foreground">
      We'll send a verification code to your phone.
    </p>
  </AuthLayout>
</template>
