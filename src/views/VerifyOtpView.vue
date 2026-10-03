<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowLeft } from '@lucide/vue'

import OtpForm from '@/components/auth/OtpForm.vue'
import { Button } from '@/components/ui/button'
import AuthLayout from '@/layouts/AuthLayout.vue'
import { useAuthStore } from '@/stores/auth'
import { formatIndianPhoneNumber } from '@/utils/phone'

const RESEND_COOLDOWN_SECONDS = 60

const authStore = useAuthStore()
const router = useRouter()

const resent = ref(false)
const secondsLeft = ref(0)
let countdown: ReturnType<typeof setInterval> | undefined

const displayPhoneNumber = computed(() =>
  authStore.pendingPhoneNumber ? formatIndianPhoneNumber(authStore.pendingPhoneNumber) : '',
)

const countdownLabel = computed(() => {
  const minutes = Math.floor(secondsLeft.value / 60)
  const seconds = secondsLeft.value % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
})

function startCooldown() {
  clearInterval(countdown)
  secondsLeft.value = RESEND_COOLDOWN_SECONDS

  countdown = setInterval(() => {
    secondsLeft.value -= 1
    if (secondsLeft.value <= 0) clearInterval(countdown)
  }, 1000)
}

// A code was just sent on the login screen.
onMounted(startCooldown)
onBeforeUnmount(() => clearInterval(countdown))

async function handleVerify(code: string) {
  resent.value = false

  try {
    await authStore.verifyOtp(code)
    await router.replace({ name: 'dashboard' })
  } catch {
    // authStore.error is shown by the form
  }
}

async function handleResend() {
  const phoneNumber = authStore.pendingPhoneNumber
  if (!phoneNumber || secondsLeft.value > 0) return

  resent.value = false

  try {
    await authStore.sendOtp(phoneNumber)
    resent.value = true
    startCooldown()
  } catch {
    // authStore.error is shown by the form
  }
}

async function handleChangeNumber() {
  authStore.resetOtpFlow()
  await router.push({ name: 'login' })
}
</script>

<template>
  <AuthLayout>
    <template #corner>
      <Button
        variant="ghost"
        size="icon"
        class="absolute top-8 left-6 text-muted-foreground sm:left-8"
        aria-label="Use a different number"
        title="Use a different number"
        @click="handleChangeNumber"
      >
        <ArrowLeft class="size-5!" />
      </Button>
    </template>

    <header class="mb-8 text-center">
      <h1 class="text-3xl font-bold tracking-tight sm:text-4xl">Verify your number</h1>
      <p class="mt-2 text-muted-foreground">
        Enter the 6-digit code sent to
        <span class="whitespace-nowrap">{{ displayPhoneNumber }}</span>
      </p>
    </header>

    <OtpForm :loading="authStore.loading" :error="authStore.error" @submit="handleVerify" />

    <div class="mt-6 text-center text-sm text-muted-foreground" role="status">
      <p v-if="resent" class="mb-1">A new code has been sent.</p>

      <p v-if="secondsLeft > 0">
        Resend code in <span class="font-semibold text-foreground">{{ countdownLabel }}</span>
      </p>
      <p v-else>
        Didn't get a code?
        <Button
          variant="link"
          class="h-auto p-0 font-semibold"
          :disabled="authStore.loading"
          @click="handleResend"
        >
          Resend code
        </Button>
      </p>
    </div>
  </AuthLayout>
</template>
