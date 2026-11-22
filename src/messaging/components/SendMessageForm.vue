<script setup lang="ts">
import { PhChatText } from '@phosphor-icons/vue'

import { Button } from '@/components/ui/button'

// Confirms texting a tenant, so a tap never texts anyone by itself. What it's about goes in the
// default slot (e.g. BillReminderSummary); the page sends it and the backend writes the text.
defineProps<{
  // What they'll get, in a sentence, above the buttons.
  note: string
  sending?: boolean
  sendError?: string | null
}>()

const emit = defineEmits<{
  send: []
  cancel: []
}>()
</script>

<template>
  <form class="space-y-5" novalidate @submit.prevent="emit('send')">
    <slot />

    <p class="text-sm text-muted-foreground">{{ note }}</p>

    <p v-if="sendError" class="text-sm text-destructive" role="alert">{{ sendError }}</p>

    <div class="grid gap-3 sm:grid-cols-2">
      <Button type="submit" class="h-11 sm:order-last" :disabled="sending">
        <PhChatText aria-hidden="true" />
        {{ sending ? 'Sending…' : 'Send SMS' }}
      </Button>
      <Button
        type="button"
        variant="secondary"
        class="h-11"
        :disabled="sending"
        @click="emit('cancel')"
      >
        Cancel
      </Button>
    </div>
  </form>
</template>
