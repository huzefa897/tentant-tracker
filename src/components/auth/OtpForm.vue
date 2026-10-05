<script setup lang="ts">
import { computed, ref } from 'vue'
import { ArrowRight, LoaderCircle } from '@lucide/vue'

import { Button } from '@/components/ui/button'
import { PinInput, PinInputGroup, PinInputSlot } from '@/components/ui/pin-input'
import { isValidOtpCode, OTP_LENGTH } from '@/utils/authValidation'

const props = defineProps<{
  loading: boolean
  error: string | null
}>()

const emit = defineEmits<{
  submit: [code: string]
}>()

const digits = ref<(number | undefined)[]>([])

const code = computed(() => digits.value.join(''))
const isCodeComplete = computed(() => isValidOtpCode(code.value))

function handleSubmit() {
  if (!isCodeComplete.value || props.loading) return

  emit('submit', code.value)
}
</script>

<template>
  <form class="space-y-6" novalidate @submit.prevent="handleSubmit">
    <div class="space-y-2">
      <PinInput
        id="otp"
        v-model="digits"
        type="number"
        :disabled="loading"
        class="w-full"
        aria-label="Verification code"
        @complete="handleSubmit"
      >
        <PinInputGroup class="w-full justify-between gap-2">
          <PinInputSlot
            v-for="(_, index) in OTP_LENGTH"
            :key="index"
            :index="index"
            class="h-14 w-full max-w-14 rounded-lg border bg-background text-xl font-medium first:rounded-lg last:rounded-lg focus:bg-muted"
            :aria-invalid="!!error"
            :aria-describedby="error ? 'otp-error' : undefined"
          />
        </PinInputGroup>
      </PinInput>

      <p v-if="error" id="otp-error" class="text-sm text-destructive" role="alert">
        {{ error }}
      </p>
    </div>

    <Button
      type="submit"
      class="relative h-12 w-full text-base hover:bg-primary/90"
      :disabled="!isCodeComplete || loading"
      :aria-busy="loading"
    >
      <LoaderCircle v-if="loading" class="size-5! animate-spin" aria-hidden="true" />
      {{ loading ? 'Verifying…' : 'Verify' }}
      <ArrowRight v-if="!loading" class="absolute right-5 size-5!" aria-hidden="true" />
    </Button>
  </form>
</template>
