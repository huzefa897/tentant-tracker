<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import UserMenu from '@/components/access/UserMenu.vue'
import AppLogo from '@/components/brand/AppLogo.vue'
import WaveBackground from '@/components/brand/WaveBackground.vue'
import AppNav from '@/components/nav/AppNav.vue'
import QuickEntryDialog from '@/components/nav/QuickEntryDialog.vue'
import RentEntryForm from '@/components/rent/RentEntryForm.vue'
import { Button } from '@/components/ui/button'
import { useLogout } from '@/composables/useLogout'
import { useQuickBill } from '@/composables/useQuickBill'
import { useAccessStore } from '@/stores/access'
import { useAuthStore } from '@/stores/auth'
import { useRentEntryStore } from '@/stores/rentEntry'
import { useTenantStore } from '@/stores/tenant'
import { isValidMonthValue, nextMonthValue, toMonthValue } from '@/utils/date'
import type { NavLink, NavSection, QuickEntryStep, RecordKind } from '@/types/nav'
import type { NewRentEntrySubmission, RentEntry } from '@/types/rentEntry'

const accessStore = useAccessStore()
const authStore = useAuthStore()
const tenantStore = useTenantStore()
const rentEntryStore = useRentEntryStore()
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

// Quick entry: what to record, then for whom, then (a bill) which month, then that screen. The
// sheet's state lives in the URL (?quick=start | bill | payment | reading, &step=month,
// &quickTenant=<id>), one history entry per step, so the browser's back goes to the step before
// and then closes it, and a reload keeps its place.
const QUICK_KEYS = ['quick', 'step', 'quickTenant', 'quickMonth'] as const
const RECORD_KINDS: RecordKind[] = ['bill', 'payment', 'reading']
const STEP_DEPTH: Record<QuickEntryStep, number> = {
  kind: 1,
  tenant: 2,
  month: 3,
  charges: 4,
  payment: 5,
  confirm: 6,
}
const BILL_STEPS = ['charges', 'payment', 'confirm'] as const

function queryText(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

const quickParam = computed(() => queryText(route.query.quick))
const quickKind = computed(() => RECORD_KINDS.find((kind) => kind === quickParam.value) ?? null)
const quickOpen = computed(() => quickParam.value === 'start' || quickKind.value !== null)
const billTenant = computed(() => {
  const id = queryText(route.query.quickTenant)
  return id ? tenantStore.getTenant(id) : null
})
const quickMonth = computed(() => {
  const month = queryText(route.query.quickMonth)
  return month && isValidMonthValue(month) ? month : null
})
const quickStep = computed<QuickEntryStep>(() => {
  if (!quickKind.value) return 'kind'
  if (quickKind.value !== 'bill' || !billTenant.value) return 'tenant'
  const step = BILL_STEPS.find((candidate) => candidate === route.query.step)
  if (step && quickMonth.value) return step
  return route.query.step === 'month' ? 'month' : 'tenant'
})
const billWizard = computed(() => BILL_STEPS.find((step) => step === quickStep.value) ?? null)
// The tenant whose page this is, offered first (the tenant pages share :tenantId).
const pageTenant = computed(() => {
  const id = route.params.tenantId
  return typeof id === 'string' ? tenantStore.getTenant(id) : null
})

// The month a new bill is for: the one after the tenant's latest bill (this month with none).
// null while that loads, so the sheet doesn't offer a month it is about to change.
const defaultMonth = computed(() => {
  const tenant = billTenant.value
  const summary = tenant ? rentEntryStore.summaries[tenant.id] : null
  if (!summary || summary.status === 'idle' || summary.status === 'loading') return null
  return summary.latest ? nextMonthValue(summary.latest.billingMonth) : toMonthValue(new Date())
})

// A reloaded or shared URL names its tenant; one the first search page does not hold is fetched by id.
watch(
  () => queryText(route.query.quickTenant),
  (tenantId) => {
    if (tenantId && !tenantStore.getTenant(tenantId)) {
      void tenantStore.loadTenant(tenantId).catch(() => null)
    }
  },
  { immediate: true },
)

watch(
  () => (quickStep.value === 'month' ? billTenant.value?.id : null),
  (tenantId) => {
    if (tenantId) void rentEntryStore.loadSummary(tenantId)
  },
  { immediate: true },
)

// Whether this visit's sheet entries are ours to step back over (not when it was opened by a
// reload or a shared link, where going back would leave the app).
let openedHere = false

watch(quickOpen, (open) => {
  if (open) {
    // Each open starts from every tenant, not the last search.
    void tenantStore.searchTenants('')
  } else {
    openedHere = false
  }
})
if (quickOpen.value) void tenantStore.searchTenants('')

function withQuick(quick: Record<string, string>) {
  const query = { ...route.query }
  for (const key of QUICK_KEYS) delete query[key]
  return { query: { ...query, ...quick } }
}

function startQuickEntry() {
  if (quickOpen.value) return
  openedHere = true
  void router.push(withQuick({ quick: 'start' }))
}

function chooseKind(kind: RecordKind) {
  void router.push(withQuick({ quick: kind }))
}

function closeQuickEntry() {
  if (!quickOpen.value) return
  if (quickBill.saving.value) return
  if (openedHere) {
    const depth = STEP_DEPTH[quickStep.value]
    openedHere = false
    router.go(-depth)
  } else {
    void router.replace(withQuick({}))
  }
}

function handleQuickOpen(open: boolean) {
  if (!open) closeQuickEntry()
}

// Each target is an existing page; the sheet's entries stay behind it, so back returns to the
// last step. A payment goes on a bill, so it opens the tenant's bills to choose which.
function chooseTenant(kind: RecordKind, tenantId: string) {
  if (kind === 'bill') {
    void router.push(withQuick({ quick: 'bill', step: 'month', quickTenant: tenantId }))
  } else if (kind === 'payment') {
    void router.push({ name: 'rent-entry-history', params: { tenantId } })
  } else {
    void router.push({ name: 'meter-readings', params: { tenantId }, query: { record: '1' } })
  }
}

function chooseMonth(tenantId: string, month: string) {
  void router.push(
    withQuick({ quick: 'bill', step: 'charges', quickTenant: tenantId, quickMonth: month }),
  )
}

// The back arrow is the browser's back; after a reload there is nothing of ours behind it, so it
// moves to the step before in place.
function goBack() {
  if (quickBill.saving.value) return
  if (openedHere) {
    router.back()
    return
  }
  const tenant = queryText(route.query.quickTenant) ?? ''
  const month = queryText(route.query.quickMonth) ?? ''
  const bill = { quick: 'bill', quickTenant: tenant, quickMonth: month }
  const previous: Record<QuickEntryStep, Record<string, string> | null> = {
    kind: null,
    tenant: { quick: 'start' },
    month: { quick: 'bill' },
    charges: { quick: 'bill', step: 'month', quickTenant: tenant },
    payment: { ...bill, step: 'charges' },
    confirm: { ...bill, step: 'payment' },
  }
  const target = previous[quickStep.value]
  if (target) void router.replace(withQuick(target))
  else closeQuickEntry()
}

// The bill's steps are the New bill form, part by part; the last saves it and opens the bill.
const quickBill = useQuickBill(billTenant)

// The bill being made: the tenant and month of the last charges step. The month step's history
// entry names no month, so stepping back to it would unmount the form and lose what was typed;
// the draft is kept instead and dropped only when the sheet closes or another tenant is chosen.
// Choosing a different month starts a new bill (the form is keyed by it).
const draft = ref<{ tenantId: string; month: string } | null>(null)
watch(
  () => [quickOpen.value && quickKind.value === 'bill', billTenant.value?.id, quickMonth.value],
  ([inBill, tenantId, month]) => {
    if (!inBill) draft.value = null
    else if (typeof tenantId === 'string' && typeof month === 'string') {
      draft.value = { tenantId, month }
    } else if (tenantId && draft.value && draft.value.tenantId !== tenantId) draft.value = null
  },
  { immediate: true },
)
const formMonth = computed(() => {
  if (quickMonth.value) return quickMonth.value
  const kept = draft.value
  return kept && kept.tenantId === billTenant.value?.id ? kept.month : null
})
watch(
  () => [billTenant.value?.id, formMonth.value],
  () => quickBill.reset(),
)

// While a bill is being saved the sheet stays put: closing it, stepping back or leaving would
// end in the saved bill opening unasked. Signing out is the one way out.
const removeSaveGuard = router.beforeEach((to) => {
  if (quickBill.saving.value && to.name !== 'login') return false
})
onBeforeUnmount(removeSaveGuard)

function advanceBill() {
  const next = billWizard.value === 'charges' ? 'payment' : 'confirm'
  const tenant = billTenant.value
  if (!tenant || !quickMonth.value) return
  void router.push(
    withQuick({ quick: 'bill', step: next, quickTenant: tenant.id, quickMonth: quickMonth.value }),
  )
}

// Leaving the sheet for a saved bill: the sheet's history entries are stepped back over first, so
// back from the bill returns to where Quick entry was opened, not into a finished sheet.
async function openBill(entry: RentEntry) {
  const depth = openedHere ? STEP_DEPTH[quickStep.value] : 0
  openedHere = false
  if (depth) {
    await new Promise<void>((resolve) => {
      const stop = router.afterEach(() => {
        stop()
        resolve()
      })
      router.go(-depth)
    })
  }
  void router.push({
    name: 'rent-entry-details',
    params: { tenantId: entry.tenantId, entryId: entry.id },
  })
}

async function saveBill(submission: NewRentEntrySubmission) {
  const entry = await quickBill.save(submission)
  if (entry) await openBill(entry)
}

function openExisting(entry: RentEntry) {
  void openBill(entry)
}

// The bar gives way to the keyboard: while one is open over a focused field it would cover what's
// typed. A phone's keyboard shrinks the visible screen (the visual viewport) without a focus
// change, so closing it with the field still focused brings the bar back. A hardware keyboard
// shrinks nothing, so the bar stays; without a visual viewport focus alone decides.
const KEYBOARD_MIN_HEIGHT = 150
const fieldFocused = ref(false)
const keyboardOpen = ref(false)
const typing = computed(() => fieldFocused.value && keyboardOpen.value)

function updateKeyboard() {
  const viewport = window.visualViewport
  // Zooming in shrinks the viewport too, but its height times its scale stays the screen's.
  keyboardOpen.value =
    !viewport || window.innerHeight - viewport.height * viewport.scale > KEYBOARD_MIN_HEIGHT
}

function isField(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.matches('input, textarea, select') || target.isContentEditable)
  )
}

function handleFocusIn(event: FocusEvent) {
  fieldFocused.value = isField(event.target)
  updateKeyboard()
}

function handleFocusOut(event: FocusEvent) {
  if (!isField(event.relatedTarget)) fieldFocused.value = false
}

onMounted(() => {
  document.addEventListener('focusin', handleFocusIn)
  document.addEventListener('focusout', handleFocusOut)
  window.visualViewport?.addEventListener('resize', updateKeyboard)
  updateKeyboard()
})
onBeforeUnmount(() => {
  document.removeEventListener('focusin', handleFocusIn)
  document.removeEventListener('focusout', handleFocusOut)
  window.visualViewport?.removeEventListener('resize', updateKeyboard)
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
          @quick-entry="startQuickEntry"
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
      @quick-entry="startQuickEntry"
    />

    <QuickEntryDialog
      :open="quickOpen"
      :step="quickStep"
      :kind="quickKind"
      :preselected="pageTenant"
      :bill-tenant="billTenant"
      :default-month="defaultMonth"
      :tenants="tenantStore.results"
      :query="tenantStore.query"
      :status="tenantStore.status"
      :error="tenantStore.error"
      :has-more="tenantStore.hasMore"
      :loading-more="tenantStore.loadingMore"
      @update:open="handleQuickOpen"
      @choose-kind="chooseKind"
      @choose-tenant="chooseTenant"
      @back="goBack"
      @choose-month="chooseMonth"
      @search="tenantStore.searchTenants"
      @load-more="tenantStore.loadMore"
    >
      <template v-if="quickKind === 'bill' && billTenant && formMonth" #bill>
        <RentEntryForm
          :key="`${billTenant.id}-${formMonth}`"
          :tenant="billTenant"
          :month="formMonth"
          :wizard="billWizard ?? 'charges'"
          :save-error="quickBill.saveError.value"
          :saving="quickBill.saving.value"
          :last-billed="quickBill.lastBilled.value"
          :latest-reading="quickBill.latestReading.value"
          :unbilled-readings="quickBill.unbilledReadings.value"
          :meter-loading="quickBill.meterLoading.value"
          :meter-error="quickBill.meterError.value"
          @retry-meter="quickBill.retryMeter"
          @advance="advanceBill"
          @back="goBack"
          @save="saveBill"
        />
        <div
          v-if="quickBill.existingEntry.value"
          class="mt-4 flex items-center gap-3 rounded-xl border bg-muted/40 p-3 text-sm"
          data-testid="quick-existing-entry"
        >
          <p class="flex-1">That month already has a saved bill for {{ billTenant.name }}.</p>
          <Button
            type="button"
            variant="outline"
            @click="quickBill.existingEntry.value && openExisting(quickBill.existingEntry.value)"
          >
            Open saved bill
          </Button>
        </div>
      </template>
    </QuickEntryDialog>
  </main>
</template>
