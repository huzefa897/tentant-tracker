<script setup lang="ts">
import { computed } from 'vue'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import SendMessageForm from '@/messaging/components/SendMessageForm.vue'
import type { MessageKind } from '@/messaging/types'
import { kindWording } from '@/messaging/utils/wording'

// The confirm dialog for any kind of message, worded for its kind; what it's about goes in the
// default slot. Wire it to useSendMessage: v-model:open="sms.isOpen", :kind, :sending, :error.
const props = defineProps<{
  kind: MessageKind | null
  sending?: boolean
  error?: string | null
}>()

const open = defineModel<boolean>('open', { required: true })

const emit = defineEmits<{
  send: []
}>()

const wording = computed(() => (props.kind ? kindWording(props.kind) : null))
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{{ wording?.title }}</DialogTitle>
        <DialogDescription>{{ wording?.description }}</DialogDescription>
      </DialogHeader>
      <SendMessageForm
        v-if="open && wording"
        :note="wording.note"
        :sending="sending"
        :send-error="error"
        @send="emit('send')"
        @cancel="open = false"
      >
        <slot />
      </SendMessageForm>
    </DialogContent>
  </Dialog>
</template>
