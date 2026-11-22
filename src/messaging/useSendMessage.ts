import { computed, ref, watch } from 'vue'

import { useMessagingStore } from '@/messaging/messaging.store'
import type { MessagePreview, MessageRequest } from '@/messaging/types'
import {
  PREVIEW_ERROR_MESSAGE,
  SEND_ERROR_MESSAGE,
  failedSendMessage,
  kindWording,
  outcomeNotice,
} from '@/messaging/utils/wording'
import { useAccessStore } from '@/stores/access'

// Send SMS for any page and any kind of message: whether it's offered on the selected property
// (asked on each visit), the confirm dialog's state, sending, and what to say after. Pair it
// with SendMessageDialog. The backend decides who may send what, and checks it all again.
//
//   const sms = useSendMessage()
//   sms.start(tenantId, { kind: 'dues_reminder' })   // opens the dialog (and its preview)
//   const notice = await sms.send(tenant.name)
export type PreviewState =
  | { status: 'none' } // this kind has none
  | { status: 'loading' }
  | { status: 'ready'; value: MessagePreview }
  | { status: 'error'; message: string } // nothing to send, or it couldn't be loaded

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
  const tenantId = ref<string | null>(null)
  // What it would say, for kinds that preview (kindWording(kind).previews).
  const preview = ref<PreviewState>({ status: 'none' })
  let previewToken = 0
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

  // Sending waits for the preview, where there is one, so nothing goes unseen.
  const canConfirm = computed(() => {
    if (!request.value) return false
    if (!kindWording(request.value.kind).previews) return true
    return preview.value.status === 'ready'
  })

  function start(forTenant: string, next: MessageRequest) {
    tenantId.value = forTenant
    request.value = next
    error.value = null
    notice.value = null
    dialogOpen.value = true
    loadPreview()
  }

  // Asked each time the dialog opens: what's owed may have changed since.
  async function loadPreview() {
    const current = request.value
    const forTenant = tenantId.value
    const token = ++previewToken
    if (!current || !forTenant || !kindWording(current.kind).previews) {
      preview.value = { status: 'none' }
      return
    }
    preview.value = { status: 'loading' }
    let next: PreviewState
    try {
      next = { status: 'ready', value: await store.preview(forTenant, current) }
    } catch (caught) {
      next = {
        status: 'error',
        message: caught instanceof Error ? caught.message : PREVIEW_ERROR_MESSAGE,
      }
    }
    if (token === previewToken) preview.value = next
  }

  // Sends what start() was given. Sent, or it may have gone (unknown): closes the dialog and
  // returns what to say. Failed or refused: keeps it open with the reason and returns null.
  async function send(recipientName: string): Promise<string | null> {
    const current = request.value
    const forTenant = tenantId.value
    if (!current || !forTenant || !canConfirm.value || sending.value) return null
    sending.value = true
    error.value = null
    try {
      const result = await store.send(forTenant, current)
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
    tenantId.value = null
    preview.value = { status: 'none' }
    previewToken++
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
    preview,
    loadPreview,
    canConfirm,
    sending,
    error,
    notice,
    start,
    send,
    reset,
  }
}
