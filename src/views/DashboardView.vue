<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { LogOut } from '@lucide/vue'

import { Button } from '@/components/ui/button'
import AppLayout from '@/layouts/AppLayout.vue'
import { useAuthStore } from '@/stores/auth'
import { formatIndianPhoneNumber } from '@/utils/phone'

const authStore = useAuthStore()
const router = useRouter()

const displayPhoneNumber = computed(() =>
  authStore.user ? formatIndianPhoneNumber(authStore.user.phoneNumber) : '',
)

async function handleLogout() {
  await authStore.logout()
  await router.replace({ name: 'login' })
}
</script>

<template>
  <AppLayout>
    <template #header-actions>
      <div class="flex items-center gap-3">
        <span class="hidden text-sm text-muted-foreground sm:inline">{{ displayPhoneNumber }}</span>
        <Button variant="secondary" class="h-10 px-4" @click="handleLogout">
          <LogOut aria-hidden="true" />
          Logout
        </Button>
      </div>
    </template>

    <h1 class="text-3xl font-bold tracking-tight">Tenant Overview</h1>
    <p class="mt-2 text-muted-foreground">Logged in as {{ displayPhoneNumber }}</p>
  </AppLayout>
</template>
