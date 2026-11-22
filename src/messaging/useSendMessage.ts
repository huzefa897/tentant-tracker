import { computed, ref, watch } from 'vue'

import { useMessagingStore } from '@/messaging/messaging.store'
import type { MessageRequest } from '@/messaging/types'
import { SEND_ERROR_MESSAGE, failedSendMessage, outcomeNotice } from '@/messaging/utils/wording'
import { useAccessStore } from '@/stores/access'

// Send SMS for any page and any kind of message: whether it's offered on the selected property
// (asked on each visit), the confirm dialog's state, sending, and what to say after. Pair it
// with SendMessageDialog. The backend decides who may send what, and checks it all again.
//
//   const sms = useSendMessage()
//   sms.start({ kind: 'bill_reminder', entryId })   // opens the dialog
//   const notice = await sms.send(tenantId, tenant.name)
export function useSendMessage() {
  const store = useMessagingStore()
  const accessStore = useAccessStore()

  watch(
    () => accessStore.selectedPropertyId,
    (propertyId) => {
      if (propertyId) void store.load(propertyId)
    },
    { immediate: true },
  )

  // On, set up and the role may send, as the backend said.
  const available = computed(() => store.canSendFor(accessStore.selectedPropertyId))
  // Whether it's offered couldn't be loaded: the page says so, with retryStatus.
  const statusFailed = computed(() => store.loadFailed(accessStore.selectedPropertyId))

  function retryStatus() {
    const propertyId = accessStore.selectedPropertyId
    if (propertyId) void store.load(propertyId)
  }

  const request = ref<MessageRequest | null>(null)
  const dialogOpen = ref(false)
  const sending = ref(false)
  const error = ref<string | null>(null)
  // Said after a send that went, or may have: the page shows it as a status.
  const notice = ref<string | null>(null)

  // The dialog stays open while sending: only the backend's answer closes it.
  const isOpen = computed({
    get: () => dialogOpen.value,
    set: (open: boolean) => {
      if (!open && sending.value) return
      dialogOpen.value = open
    },
  })

  const kind = computed(() => request.value?.kind ?? null)

  function start(next: MessageRequest) {
    request.value = next
    error.value = null
    notice.value = null
    dialogOpen.value = true
  }

  // Sends what start() was given. Sent, or it may have gone (unknown): closes the dialog and
  // returns what to say. Failed or refused: keeps it open with the reason and returns null.
  async function send(tenantId: string, recipientName: string): Promise<string | null> {
    const current = request.value
    if (!current || sending.value) return null
    sending.value = true
    error.value = null
    try {
      const result = await store.send(tenantId, current)
      const said = outcomeNotice(current.kind, result, recipientName)
      if (said === null) {
        error.value = failedSendMessage(result.reason)
        return null
      }
      dialogOpen.value = false
      notice.value = said
      return said
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : SEND_ERROR_MESSAGE
      return null
    } finally {
      sending.value = false
    }
  }

  // Another tenant or bill on the same page: nothing about the last one carries over.
  function reset() {
    dialogOpen.value = false
    request.value = null
    error.value = null
    notice.value = null
  }

  return {
    available,
    statusFailed,
    retryStatus,
    request,
    kind,
    isOpen,
    sending,
    error,
    notice,
    start,
    send,
    reset,
  }
}
