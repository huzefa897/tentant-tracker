<script setup lang="ts">
import { computed, ref, useTemplateRef, watch } from 'vue'
import { ArrowRight, LoaderCircle, Trash2 } from '@lucide/vue'

import { Button } from '@/components/ui/button'
import { PinInput, PinInputGroup, PinInputSlot } from '@/components/ui/pin-input'
import { isValidOtpCode, OTP_LENGTH } from '@/utils/authValidation'

const props = defineProps<{
  loading: boolean
  error: string | null
}>()

const emit = defineEmits<{
  submit: [code: string]
  // The code was cleared, so an error about the old one no longer applies.
  clear: []
}>()

const form = useTemplateRef<HTMLFormElement>('form')
const digits = ref<(number | undefined)[]>([])

const code = computed(() => digits.value.join(''))
const isCodeComplete = computed(() => isValidOtpCode(code.value))
const hasDigits = computed(() => digits.value.some((digit) => digit !== undefined))

// The last code sent on its own, so a code is verified once when its last digit goes in
// (typed, pasted or filled from the SMS), and again only after it changes. Verify always sends.
let autoSubmitted: string | null = null

function handleSubmit() {
  if (!isCodeComplete.value || props.loading) return

  autoSubmitted = code.value
  emit('submit', code.value)
}

watch(code, (next) => {
  if (isValidOtpCode(next) && next !== autoSubmitted) handleSubmit()
})

function handleClear() {
  digits.value = []
  autoSubmitted = null
  emit('clear')
  form.value?.querySelector('input')?.focus()
}
</script>

<template>
  <form ref="form" class="space-y-8" novalidate @submit.prevent="handleSubmit">
    <div class="space-y-2">
      <PinInput
        id="otp"
        v-model="digits"
        type="number"
        otp
        :disabled="loading"
        class="w-full"
        aria-label="Verification code"
      >
        <PinInputGroup class="w-full justify-between gap-2">
          <PinInputSlot
            v-for="(_, index) in OTP_LENGTH"
            :key="index"
            :index="index"
            class="h-14 w-full max-w-14 rounded-xl border bg-muted/30 text-xl font-medium shadow-sm first:rounded-xl last:rounded-xl focus:bg-background"
            :aria-invalid="!!error"
            :aria-describedby="error ? 'otp-error' : undefined"
          />
        </PinInputGroup>
      </PinInput>

      <p v-if="error" id="otp-error" class="text-sm text-destructive" role="alert">
        {{ error }}
      </p>
    </div>

    <!-- Clear sits with Verify, well apart from the slots. -->
    <div class="flex flex-col items-center gap-4">
      <Button
        type="button"
        variant="ghost"
        class="h-9 text-muted-foreground"
        :disabled="!hasDigits || loading"
        data-testid="clear-code"
        @click="handleClear"
      >
        <Trash2 aria-hidden="true" />
        Clear code
      </Button>

      <Button
        type="submit"
        class="relative h-12 w-full rounded-xl text-base shadow-sm hover:bg-primary/90"
        :disabled="!isCodeComplete || loading"
        :aria-busy="loading"
      >
        <LoaderCircle v-if="loading" class="size-5! animate-spin" aria-hidden="true" />
        {{ loading ? 'Verifying…' : 'Verify' }}
        <ArrowRight v-if="!loading" class="absolute right-5 size-5!" aria-hidden="true" />
      </Button>
    </div>
  </form>
</template>
