<script setup lang="ts">
import { watch } from 'vue'
import { RouterView, useRoute, useRouter } from 'vue-router'

import { useInactivityTimer } from '@/composables/useInactivityTimer'
import { useAccessStore } from '@/stores/access'
import { useAuthStore } from '@/stores/auth'
import { useTenantStore } from '@/stores/tenant'

const authStore = useAuthStore()
const accessStore = useAccessStore()
const tenantStore = useTenantStore()
const route = useRoute()
const router = useRouter()

useInactivityTimer()

// Firebase can end the session outside a logout (signed out in another tab, account disabled,
// token revoked): drop per-user state and leave protected pages.
watch(
  () => authStore.user?.id ?? null,
  (userId, previousUserId) => {
    if (previousUserId && userId !== previousUserId) {
      accessStore.clear()
      tenantStore.reset()
    }

    if (!userId && (route.meta.requiresAuth || route.meta.requiresProperty)) {
      router.replace({ name: 'login' })
    }
  },
)
</script>

<template>
  <RouterView />
</template>
