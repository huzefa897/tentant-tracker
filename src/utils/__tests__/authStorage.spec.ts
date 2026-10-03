import { beforeEach, describe, expect, it } from 'vitest'

import {
  clearStoredAuthUser,
  clearStoredPendingPhoneNumber,
  getStoredAuthUser,
  getStoredPendingPhoneNumber,
  saveAuthUser,
  savePendingPhoneNumber,
} from '@/utils/authStorage'

const user = { id: 'mock-user-1', phoneNumber: '+918341413827' }

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

describe('auth user storage', () => {
  it('returns null when nothing is stored', () => {
    expect(getStoredAuthUser()).toBeNull()
  })

  it('round-trips a saved user through localStorage', () => {
    saveAuthUser(user)

    expect(getStoredAuthUser()).toEqual(user)
  })

  it('clears a stored user', () => {
    saveAuthUser(user)
    clearStoredAuthUser()

    expect(getStoredAuthUser()).toBeNull()
  })

  it('drops corrupt JSON instead of throwing', () => {
    localStorage.setItem('rent-tracker-auth-user', '{not json')

    expect(getStoredAuthUser()).toBeNull()
    expect(localStorage.getItem('rent-tracker-auth-user')).toBeNull()
  })
})

describe('pending phone number storage', () => {
  it('returns null when nothing is stored', () => {
    expect(getStoredPendingPhoneNumber()).toBeNull()
  })

  it('round-trips a valid number through sessionStorage', () => {
    savePendingPhoneNumber('+918341413827')

    expect(getStoredPendingPhoneNumber()).toBe('+918341413827')
    expect(localStorage.length).toBe(0)
  })

  it('clears a stored number', () => {
    savePendingPhoneNumber('+918341413827')
    clearStoredPendingPhoneNumber()

    expect(getStoredPendingPhoneNumber()).toBeNull()
  })

  it('drops an invalid stored number', () => {
    sessionStorage.setItem('rent-tracker-pending-phone', '12345')

    expect(getStoredPendingPhoneNumber()).toBeNull()
    expect(sessionStorage.getItem('rent-tracker-pending-phone')).toBeNull()
  })
})
