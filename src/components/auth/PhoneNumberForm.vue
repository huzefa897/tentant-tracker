<script setup lang="ts">
import { computed, ref } from 'vue'
import { ArrowRight } from '@lucide/vue'

import IndiaFlag from '@/components/brand/IndiaFlag.vue'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'

const COUNTRY_CODE = '+91'

const props = defineProps<{
  loading: boolean
  error: string | null
}>()

const emit = defineEmits<{
  submit: [phoneNumber: string]
}>()

const digits = ref('')

// Display as "83414 13827"; keep only digits in state.
const displayValue = computed({
  get: () =>
    digits.value.length > 5 ? `${digits.value.slice(0, 5)} ${digits.value.slice(5)}` : digits.value,
  set: (value: string) => {
    digits.value = value.replace(/\D/g, '').slice(0, 10)
  },
})

// Indian mobile numbers: 10 digits starting 6-9.
const isPhoneValid = computed(() => /^[6-9]\d{9}$/.test(digits.value))

function handleSubmit() {
  if (!isPhoneValid.value || props.loading) return

  emit('submit', `${COUNTRY_CODE}${digits.value}`)
}
</script>

<template>
  <form class="space-y-6" novalidate @submit.prevent="handleSubmit">
    <div class="space-y-2">
      <Label for="phone" class="text-muted-foreground">Phone number</Label>

      <div
        class="flex h-13 items-center rounded-lg border border-input bg-muted transition-shadow focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/30"
        :class="{ 'border-destructive': !!error }"
      >
        <div class="flex items-center gap-2.5 pl-4 pr-3">
          <IndiaFlag />
          <span class="text-base">{{ COUNTRY_CODE }}</span>
        </div>

        <span class="h-7 w-px bg-input" aria-hidden="true" />

        <input
          id="phone"
          v-model="displayValue"
          type="tel"
          inputmode="numeric"
          autocomplete="tel-national"
          placeholder="98765 43210"
          class="h-full min-w-0 flex-1 bg-transparent px-4 text-base outline-none placeholder:text-muted-foreground/60"
          :aria-invalid="!!error"
          :aria-describedby="error ? 'phone-error' : undefined"
        />
      </div>

      <p v-if="error" id="phone-error" class="text-sm text-destructive" role="alert">
        {{ error }}
      </p>
    </div>

    <Button
      type="submit"
      class="relative h-12 w-full text-base hover:bg-primary/90"
      :disabled="!isPhoneValid || loading"
    >
      {{ loading ? 'Sending code...' : 'Continue' }}
      <ArrowRight v-if="!loading" class="absolute right-5 size-5!" aria-hidden="true" />
    </Button>
  </form>
</template>
