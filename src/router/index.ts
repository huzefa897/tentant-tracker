import { createRouter, createWebHistory } from 'vue-router'

import { useAccessStore } from '@/stores/access'
import { useAuthStore } from '@/stores/auth'
import DashboardView from '@/views/DashboardView.vue'
import LoginView from '@/views/LoginView.vue'
import VerifyOtpView from '@/views/VerifyOtpView.vue'

declare module 'vue-router' {
  interface RouteMeta {
    requiresAuth?: boolean
    guestOnly?: boolean
    // Needs a selected property the user has access to (implies requiresAuth).
    requiresProperty?: boolean
  }
}

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      redirect: { name: 'login' },
    },
    {
      path: '/login',
      name: 'login',
      component: LoginView,
      meta: { guestOnly: true },
    },
    {
      path: '/verify',
      name: 'verify',
      component: VerifyOtpView,
      meta: { guestOnly: true },
    },
    {
      path: '/dashboard',
      name: 'dashboard',
      component: DashboardView,
      meta: { requiresAuth: true, requiresProperty: true },
    },
    // Loading, no-access and multi-property selection after sign-in.
    {
      path: '/properties',
      name: 'property-select',
      component: () => import('@/views/PropertySelectView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/tenants/:tenantId/entries/new',
      name: 'rent-entry-new',
      component: () => import('@/views/NewRentEntryView.vue'),
      props: true,
      meta: { requiresAuth: true, requiresProperty: true },
    },
    {
      path: '/tenants/:tenantId/entries',
      name: 'rent-entry-history',
      component: () => import('@/views/RentEntryHistoryView.vue'),
      props: true,
      meta: { requiresAuth: true, requiresProperty: true },
    },
    // After /entries/new, so "new" reads as its own route rather than an entry id.
    {
      path: '/tenants/:tenantId/entries/:entryId',
      name: 'rent-entry-details',
      component: () => import('@/views/RentEntryDetailsView.vue'),
      // ?from=dashboard sends the back button to the dashboard; anything else, to the history.
      // ?corrected=1: it's the replacement just made by correcting a bill.
      // ?pay=1 opens Record Payment once the bill has loaded (the dashboard's Record payment).
      props: (route) => ({
        ...route.params,
        from: route.query.from === 'dashboard' ? 'dashboard' : 'history',
        corrected: route.query.corrected === '1',
        pay: route.query.pay === '1',
      }),
      meta: { requiresAuth: true, requiresProperty: true },
    },
    {
      path: '/tenants/:tenantId/entries/:entryId/correct',
      name: 'rent-entry-correct',
      component: () => import('@/views/RentEntryCorrectionView.vue'),
      props: true,
      meta: { requiresAuth: true, requiresProperty: true },
    },
    {
      path: '/:pathMatch(.*)*',
      redirect: { name: 'login' },
    },
  ],
})

// Pinia is installed before the router in main.ts, so the store is available here.
// Guards are UX only: the backend enforces authentication and property access.
router.beforeEach(async (to) => {
  const authStore = useAuthStore()

  // Firebase restores a saved session asynchronously; decide only once it has.
  await authStore.init()

  if ((to.meta.requiresAuth || to.meta.requiresProperty) && !authStore.isAuthenticated) {
    return { name: 'login' }
  }

  if (to.meta.guestOnly && authStore.isAuthenticated) {
    return { name: 'dashboard' }
  }

  // /verify only makes sense mid-flow; the pending code doesn't survive a refresh.
  if (to.name === 'verify' && !authStore.pendingPhoneNumber) {
    return { name: 'login' }
  }

  if (to.meta.requiresProperty) {
    const accessStore = useAccessStore()
    await accessStore.load()

    // The backend refused this number and the session was ended.
    if (!authStore.isAuthenticated) {
      return { name: 'login' }
    }

    // Loading failed, no access, or several properties and none chosen yet.
    if (!accessStore.selectedProperty) {
      return { name: 'property-select', query: { redirect: to.fullPath } }
    }
  }
})

export default router
