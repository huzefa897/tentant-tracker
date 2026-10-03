import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import { authService } from '@/services/auth.service'
import type { AuthUser } from '@/types/auth'
import { clearStoredAuthUser, getStoredAuthUser, saveAuthUser } from '@/utils/authStorage'

export const useAuthStore = defineStore('auth', () => {
  const user = ref<AuthUser | null>(getStoredAuthUser())
  const pendingPhoneNumber = ref<string | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  const isAuthenticated = computed(() => user.value !== null)

  async function sendOtp(phoneNumber: string) {
    loading.value = true
    error.value = null

    try {
      await authService.sendOtp({ phoneNumber })
      pendingPhoneNumber.value = phoneNumber
    } catch (err) {
      error.value = 'Unable to send verification code. Please try again.'
      throw err
    } finally {
      loading.value = false
    }
  }

  async function verifyOtp(code: string) {
    if (!pendingPhoneNumber.value) {
      throw new Error('Phone number missing')
    }

    loading.value = true
    error.value = null

    try {
      const authenticatedUser = await authService.verifyOtp({
        phoneNumber: pendingPhoneNumber.value,
        code,
      })

      user.value = authenticatedUser
      saveAuthUser(authenticatedUser)
      pendingPhoneNumber.value = null
    } catch (err) {
      error.value = 'Invalid verification code. Please try again.'
      throw err
    } finally {
      loading.value = false
    }
  }

  function resetOtpFlow() {
    pendingPhoneNumber.value = null
    error.value = null
  }

  function clearError() {
    error.value = null
  }

  async function logout() {
    await authService.logout()

    user.value = null
    clearStoredAuthUser()
    resetOtpFlow()
  }

  return {
    user,
    pendingPhoneNumber,
    loading,
    error,
    isAuthenticated,
    sendOtp,
    verifyOtp,
    resetOtpFlow,
    clearError,
    logout,
  }
})
