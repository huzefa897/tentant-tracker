<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import UserMenu from '@/components/access/UserMenu.vue'
import AppLogo from '@/components/brand/AppLogo.vue'
import WaveBackground from '@/components/brand/WaveBackground.vue'
import AppNav from '@/components/nav/AppNav.vue'
import RecordDialog from '@/components/nav/RecordDialog.vue'
import { useLogout } from '@/composables/useLogout'
import { useAccessStore } from '@/stores/access'
import { useAuthStore } from '@/stores/auth'
import { useTenantStore } from '@/stores/tenant'
import type { NavLink, NavSection, RecordKind } from '@/types/nav'

const accessStore = useAccessStore()
const authStore = useAuthStore()
const tenantStore = useTenantStore()
const route = useRoute()
const router = useRouter()
const logout = useLogout()

// The account menu is the same on every screen, so the layout wires it rather than each view.
// Until /me answers (or if it fails) the Google email stands in, so logout is always there.
const name = computed(() => accessStore.identity?.name ?? '')
const email = computed(() => accessStore.identity?.email ?? authStore.user?.email ?? '')
const canSwitchProperty = computed(
  () => accessStore.properties.length > 1 && route.name !== 'property-select',
)

function switchProperty() {
  router.push({ name: 'property-select' })
}

// The sections need a property to show, so the nav waits for one (not on the property page
// before one is chosen, or without access). Without it, the account menu is the way out.
const showNav = computed(() => !!accessStore.selectedProperty)

const SECTION_ROUTES: Record<NavSection, { name: string; label: string }> = {
  home: { name: 'dashboard', label: 'Home' },
  tenants: { name: 'tenants', label: 'Tenants' },
  account: { name: 'account', label: 'Account' },
}

function linkTo(section: NavSection): NavLink {
  const { name: routeName, label } = SECTION_ROUTES[section]
  return { section, label, href: router.resolve({ name: routeName }).href }
}

// On a phone, Account is in the bar; on wider screens the account menu in the header is.
const barLinks = computed(() => (['home', 'tenants', 'account'] as const).map(linkTo))
const headerLinks = computed(() => (['home', 'tenants'] as const).map(linkTo))
const section = computed(() => route.meta.section ?? null)

function navigate(next: NavSection) {
  router.push({ name: SECTION_ROUTES[next].name })
}

// + Record: what to record, then for whom, then that screen.
const recording = ref(false)

function startRecord() {
  recording.value = true
  // Each open starts from every tenant, not the last search.
  void tenantStore.searchTenants('')
}

function record(kind: RecordKind, tenantId: string) {
  recording.value = false
  if (kind === 'bill') router.push({ name: 'rent-entry-new', params: { tenantId } })
  else router.push({ name: 'meter-readings', params: { tenantId }, query: { record: '1' } })
}

// The bar gives way to the keyboard: while a field has focus it would cover what's typed.
const typing = ref(false)

function isField(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.matches('input, textarea, select') || target.isContentEditable)
  )
}

function handleFocusIn(event: FocusEvent) {
  typing.value = isField(event.target)
}

function handleFocusOut(event: FocusEvent) {
  if (!isField(event.relatedTarget)) typing.value = false
}

onMounted(() => {
  document.addEventListener('focusin', handleFocusIn)
  document.addEventListener('focusout', handleFocusOut)
})
onBeforeUnmount(() => {
  document.removeEventListener('focusin', handleFocusIn)
  document.removeEventListener('focusout', handleFocusOut)
})
</script>

<!-- The logo and account menu sit on the backdrop; the card below fills the rest of the screen,
     leaving a thin strip of backdrop so it still reads as floating. It stops growing at 1800px
     so tables stay readable on very wide monitors. On a phone the nav floats at the bottom, and
     the page leaves room for it. -->
<template>
  <main
    class="relative min-h-dvh overflow-clip bg-[#020f2e] p-3 sm:p-5 lg:p-6"
    :class="showNav && 'max-sm:pb-[calc(6rem+env(safe-area-inset-bottom))]'"
  >
    <WaveBackground />

    <div
      class="relative mx-auto flex min-h-[calc(100dvh-1.5rem)] w-full max-w-[1800px] flex-col sm:min-h-[calc(100dvh-2.5rem)] lg:min-h-[calc(100dvh-3rem)]"
    >
      <header
        class="flex items-center justify-between gap-4 px-2 pb-3 text-white sm:px-6 sm:pb-5 lg:px-8"
        data-testid="app-header"
      >
        <AppLogo />
        <AppNav
          v-if="showNav"
          class="max-sm:hidden"
          variant="header"
          :links="headerLinks"
          :current="section"
          @navigate="navigate"
          @record="startRecord"
        />
        <!-- On a phone with the nav, Account in the bar stands in for it. -->
        <div :class="showNav && 'max-sm:hidden'">
          <UserMenu
            :name="name"
            :email="email"
            :can-switch-property="canSwitchProperty"
            @switch-property="switchProperty"
            @logout="logout"
          />
        </div>
      </header>

      <div
        class="flex flex-1 flex-col rounded-2xl bg-card text-card-foreground shadow-2xl shadow-black/30"
        data-testid="app-card"
      >
        <!-- The screen's main control (the tenant search), centred at the top of the card. -->
        <div
          v-if="$slots.toolbar"
          class="flex justify-center border-b px-4 py-4 sm:px-10 lg:px-12"
          data-testid="app-toolbar"
        >
          <div class="w-full max-w-xl min-w-0">
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

    <AppNav
      v-if="showNav"
      v-show="!typing"
      class="fixed inset-x-3 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-40 sm:hidden"
      variant="bar"
      :links="barLinks"
      :current="section"
      @navigate="navigate"
      @record="startRecord"
    />

    <RecordDialog
      v-model:open="recording"
      :tenants="tenantStore.results"
      :query="tenantStore.query"
      :status="tenantStore.status"
      :error="tenantStore.error"
      :has-more="tenantStore.hasMore"
      :loading-more="tenantStore.loadingMore"
      @choose="record"
      @search="tenantStore.searchTenants"
      @load-more="tenantStore.loadMore"
    />
  </main>
</template>
