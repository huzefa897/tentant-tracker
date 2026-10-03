import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useAppStore = defineStore('app', () => {
  const appName = ref('Rent Tracker')

  return {
    appName,
  }
})
