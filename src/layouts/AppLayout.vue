<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import UserMenu from '@/components/access/UserMenu.vue'
import AppLogo from '@/components/brand/AppLogo.vue'
import WaveBackground from '@/components/brand/WaveBackground.vue'
import { useLogout } from '@/composables/useLogout'
import { useAccessStore } from '@/stores/access'
import { useAuthStore } from '@/stores/auth'

const accessStore = useAccessStore()
const authStore = useAuthStore()
const route = useRoute()
const router = useRouter()
const logout = useLogout()

// The account menu is the same on every screen, so the layout wires it rather than each view.
// Until /me answers (or if it fails) the Firebase number stands in, so logout is always there.
const name = computed(() => accessStore.identity?.name ?? '')
const phoneNumber = computed(
  () => accessStore.identity?.phoneNumber ?? authStore.user?.phoneNumber ?? '',
)
const canSwitchProperty = computed(
  () => accessStore.properties.length > 1 && route.name !== 'property-select',
)

function switchProperty() {
  router.push({ name: 'property-select' })
}
</script>

<!-- The logo and account menu sit on the backdrop; the card below fills the rest of the screen,
     leaving a thin strip of backdrop so it still reads as floating. It stops growing at 1800px
     so tables stay readable on very wide monitors. -->
<template>
  <main class="relative min-h-dvh overflow-clip bg-[#020f2e] p-3 sm:p-5 lg:p-6">
    <WaveBackground />

    <div
      class="relative mx-auto flex min-h-[calc(100dvh-1.5rem)] w-full max-w-[1800px] flex-col sm:min-h-[calc(100dvh-2.5rem)] lg:min-h-[calc(100dvh-3rem)]"
    >
      <header
        class="flex items-center justify-between gap-4 px-2 pb-3 text-white sm:px-6 sm:pb-5 lg:px-8"
        data-testid="app-header"
      >
        <AppLogo />
        <UserMenu
          :name="name"
          :phone-number="phoneNumber"
          :can-switch-property="canSwitchProperty"
          @switch-property="switchProperty"
          @logout="logout"
        />
      </header>

      <div
        class="flex flex-1 flex-col rounded-2xl bg-card text-card-foreground shadow-2xl shadow-black/30"
        data-testid="app-card"
      >
        <!-- The way back on the left, the screen's main control (the tenant search) centred. -->
        <div
          v-if="$slots.back || $slots.toolbar"
          class="grid items-center gap-3 border-b px-4 py-4 sm:grid-cols-[1fr_minmax(0,36rem)_1fr] sm:px-10 lg:px-12"
          data-testid="app-toolbar"
        >
          <div class="min-w-0 justify-self-start">
            <slot name="back" />
          </div>
          <div v-if="$slots.toolbar" class="w-full min-w-0">
            <slot name="toolbar" />
          </div>
        </div>

        <!-- Each screen mounts its own layout, so the content eases in on every screen change. -->
        <div
          class="flex-1 animate-page-in px-4 py-6 sm:px-10 sm:py-8 lg:px-12 lg:py-10"
          data-testid="app-content"
        >
          <slot />
        </div>
      </div>
    </div>
  </main>
</template>
