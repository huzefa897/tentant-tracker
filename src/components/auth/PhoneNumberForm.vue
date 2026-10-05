<script setup lang="ts">
import { computed, ref } from 'vue'
import { ArrowRight, ChevronDown, LoaderCircle } from '@lucide/vue'

import CountryFlag from '@/components/brand/CountryFlag.vue'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { isValidMobileDigits } from '@/utils/authValidation'
import {
  DEFAULT_PHONE_COUNTRY,
  getPhoneCountry,
  groupNationalDigits,
  PHONE_COUNTRIES,
  toNationalDigits,
  type PhoneCountryCode,
} from '@/utils/phoneCountries'

const props = defineProps<{
  loading: boolean
  error: string | null
}>()

const emit = defineEmits<{
  submit: [phoneNumber: string]
}>()

const countryCode = ref<PhoneCountryCode>(DEFAULT_PHONE_COUNTRY.code)
const country = computed(() => getPhoneCountry(countryCode.value))
const digits = ref('')

// Display grouped per country ("83414 13827", "412 345 678"); keep only digits in state.
const displayValue = computed({
  get: () => groupNationalDigits(country.value, digits.value),
  set: (value: string) => {
    digits.value = toNationalDigits(country.value, value)
  },
})

const isPhoneValid = computed(() => isValidMobileDigits(country.value, digits.value))

function handleCountryChange() {
  // Keep what was typed, trimmed to the new country's length.
  digits.value = digits.value.slice(0, country.value.maxDigits)
}

function handleSubmit() {
  if (!isPhoneValid.value || props.loading) return

  emit('submit', `${country.value.dialCode}${digits.value}`)
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
        <!-- Native select over the flag + dial code: accessible and uses the OS picker on phones. -->
        <div class="relative flex h-full items-center gap-2 pl-4 pr-3">
          <CountryFlag :code="country.code" />
          <span class="text-base">{{ country.dialCode }}</span>
          <ChevronDown class="size-4 text-muted-foreground" aria-hidden="true" />

          <select
            id="phone-country"
            v-model="countryCode"
            aria-label="Country"
            class="absolute inset-0 cursor-pointer opacity-0"
            @change="handleCountryChange"
          >
            <option v-for="option in PHONE_COUNTRIES" :key="option.code" :value="option.code">
              {{ option.name }} ({{ option.dialCode }})
            </option>
          </select>
        </div>

        <span class="h-7 w-px bg-input" aria-hidden="true" />

        <input
          id="phone"
          v-model="displayValue"
          type="tel"
          inputmode="numeric"
          autocomplete="tel-national"
          :placeholder="country.placeholder"
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
      :aria-busy="loading"
    >
      <LoaderCircle v-if="loading" class="size-5! animate-spin" aria-hidden="true" />
      {{ loading ? 'Sending code…' : 'Continue' }}
      <ArrowRight v-if="!loading" class="absolute right-5 size-5!" aria-hidden="true" />
    </Button>

    <!-- The invisible reCAPTCHA check runs first and can take a few seconds (or show a puzzle). -->
    <p class="min-h-5 text-center text-sm text-muted-foreground" role="status">
      <template v-if="loading">Running a quick security check…</template>
    </p>
  </form>
</template>
