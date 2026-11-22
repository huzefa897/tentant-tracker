import { describe, expect, it } from 'vitest'

import {
  SEND_ERROR_MESSAGE,
  failedSendMessage,
  kindWording,
  outcomeNotice,
} from '@/messaging/utils/wording'

describe('failedSendMessage', () => {
  it("gives the backend's reason, to try again", () => {
    expect(failedSendMessage('The provider refused the message.')).toBe(
      "The SMS wasn't sent: The provider refused the message. Try again.",
    )
  })

  it('falls back to a plain sentence without one', () => {
    expect(failedSendMessage('')).toBe(SEND_ERROR_MESSAGE)
    expect(failedSendMessage('   ')).toBe(SEND_ERROR_MESSAGE)
  })
})

describe('outcomeNotice', () => {
  it('says it was sent, to whom', () => {
    expect(outcomeNotice('bill_reminder', { outcome: 'sent', reason: '' }, 'Meera')).toBe(
      'SMS reminder sent to Meera.',
    )
  })

  it('says an unconfirmed one may have gone', () => {
    expect(outcomeNotice('bill_reminder', { outcome: 'unknown', reason: 'x' }, 'Meera')).toBe(
      kindWording('bill_reminder').unconfirmed,
    )
  })

  it('says nothing for a failed one: the dialog shows why', () => {
    expect(outcomeNotice('bill_reminder', { outcome: 'failed', reason: 'x' }, 'Meera')).toBeNull()
  })
})

describe('kindWording', () => {
  it("words a bill reminder's dialog", () => {
    expect(kindWording('bill_reminder')).toMatchObject({
      title: 'Send SMS reminder',
      description: 'Text the tenant about this bill now.',
    })
  })
})
