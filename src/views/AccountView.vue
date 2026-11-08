<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowLeftRight, Building2, LogOut, User } from '@lucide/vue'

import { Button } from '@/components/ui/button'
import { useLogout } from '@/composables/useLogout'
import AppLayout from '@/layouts/AppLayout.vue'
import { useAccessStore } from '@/stores/access'
import { useAuthStore } from '@/stores/auth'

// Who is signed in, the property they're working in, switching property and logging out: the
// header's account menu as a page, for the bottom nav on a phone.
const router = useRouter()
const accessStore = useAccessStore()
const authStore = useAuthStore()
const logout = useLogout()

// Opened directly, /me may not have been asked yet (this page needs no property).
onMounted(() => accessStore.load())

// Until /me answers (or if it fails) the Google email stands in.
const name = computed(() => accessStore.identity?.name?.trim() ?? '')
const email = computed(() => accessStore.identity?.email ?? authStore.user?.email ?? '')
const canSwitchProperty = computed(() => accessStore.properties.length > 1)

function switchProperty() {
  router.push({ name: 'property-select' })
}
</script>

<template>
  <AppLayout>
    <div class="mx-auto w-full max-w-xl">
      <h1 class="mb-6 text-3xl font-bold tracking-tight sm:text-4xl">Account</h1>

      <section class="rounded-xl border bg-card p-4 sm:p-6" aria-labelledby="account-name">
        <div class="flex items-center gap-4">
          <div
            class="flex size-12 shrink-0 items-center justify-center rounded-full bg-secondary text-primary"
            aria-hidden="true"
          >
            <User class="size-6" />
          </div>
          <div class="min-w-0">
            <h2 id="account-name" class="truncate text-lg font-semibold" data-testid="account-name">
              {{ name || email || 'Account' }}
            </h2>
            <p v-if="name && email" class="truncate text-sm text-muted-foreground">
              {{ email }}
            </p>
          </div>
        </div>

        <dl v-if="accessStore.selectedProperty" class="mt-5 border-t pt-5">
          <dt class="text-sm text-muted-foreground">Property</dt>
          <dd class="mt-0.5 flex items-center gap-2 font-semibold" data-testid="account-property">
            <Building2 class="size-4 text-muted-foreground" aria-hidden="true" />
            {{ accessStore.selectedProperty.name }}
          </dd>
        </dl>

        <div class="mt-6 flex flex-col gap-3 sm:flex-row">
          <Button
            v-if="canSwitchProperty"
            variant="outline"
            class="h-11 px-6"
            data-testid="account-switch-property"
            @click="switchProperty"
          >
            <ArrowLeftRight aria-hidden="true" />
            Switch property
          </Button>
          <Button variant="outline" class="h-11 px-6" data-testid="account-logout" @click="logout">
            <LogOut aria-hidden="true" />
            Logout
          </Button>
        </div>
      </section>
    </div>
  </AppLayout>
</template>
