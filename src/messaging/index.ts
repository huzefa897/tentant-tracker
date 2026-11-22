// Messaging: texting tenants (docs/messaging.md). Import from '@/messaging' anywhere in the app;
// what isn't exported here is the package's own. Inside, the usual layers hold: the service
// alone talks to the API, the store keeps shared state, components take props and emit.
export { default as BillReminderSummary } from './components/BillReminderSummary.vue'
export { default as SendMessageDialog } from './components/SendMessageDialog.vue'
export { default as SendMessageForm } from './components/SendMessageForm.vue'
export { MessageSendError, useMessagingStore } from './messaging.store'
export type {
  MessageKind,
  MessageOutcome,
  MessageRequest,
  PropertyMessaging,
  SendMessageResult,
} from './types'
export { useSendMessage } from './useSendMessage'
export {
  SEND_ERROR_MESSAGE,
  SEND_UNCONFIRMED_MESSAGE,
  STATUS_ERROR_MESSAGE,
  failedSendMessage,
  kindWording,
  outcomeNotice,
} from './utils/wording'
