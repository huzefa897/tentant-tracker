<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Building2 } from '@lucide/vue'

import PropertyPicker from '@/components/access/PropertyPicker.vue'
import LoadingRegion from '@/components/common/LoadingRegion.vue'
import SkeletonRows from '@/components/common/SkeletonRows.vue'
import RentEntriesLoadError from '@/components/rent/RentEntriesLoadError.vue'
import AppLayout from '@/layouts/AppLayout.vue'
import { useAccessStore } from '@/stores/access'
import { formatPhoneNumber } from '@/utils/phone'

const accessStore = useAccessStore()
const route = useRoute()
const router = useRouter()

onMounted(() => {
  accessStore.load()
})

// Shown so the owner knows which account to grant access to.
const signedInAs = computed(() => {
  const phoneNumber = accessStore.identity?.phoneNumber
  return phoneNumber ? formatPhoneNumber(phoneNumber) : null
})

// Only follow redirects to app pages, never to another origin.
const redirectTarget = computed(() => {
  const redirect = route.query.redirect
  if (typeof redirect !== 'string' || !redirect.startsWith('/') || redirect.startsWith('//')) {
    return null
  }
  const resolved = router.resolve(redirect)
  return resolved.matched.length > 0 && resolved.meta.requiresProperty ? resolved.fullPath : null
})

async function handleSelect(propertyId: string) {
  accessStore.selectProperty(propertyId)
  await router.replace(redirectTarget.value ?? { name: 'dashboard' })
}
</script>

<template>
  <AppLayout>
    <div class="mx-auto w-full max-w-xl">
      <!-- The picker's own shape while properties load, so nothing jumps when they arrive. -->
      <LoadingRegion
        v-if="accessStore.status === 'idle' || accessStore.status === 'loading'"
        label="Loading your properties…"
      >
        <div class="mb-6">
          <p class="text-3xl font-bold tracking-tight sm:text-4xl">Choose a property</p>
          <p class="mt-2 text-muted-foreground">Select the property you want to manage.</p>
        </div>
        <SkeletonRows bordered :rows="2" />
      </LoadingRegion>

      <RentEntriesLoadError
        v-else-if="accessStore.status === 'error'"
        :message="accessStore.error ?? ''"
        @retry="accessStore.load"
      />

      <div
        v-else-if="accessStore.properties.length === 0"
        class="flex flex-col items-center rounded-2xl border border-dashed px-6 py-14 text-center"
        data-testid="no-property-access"
      >
        <div
          class="mb-4 flex size-14 items-center justify-center rounded-full bg-secondary text-primary"
          aria-hidden="true"
        >
          <Building2 class="size-7" />
        </div>
        <h1 class="text-lg font-semibold">No property access</h1>
        <p class="mt-1 max-w-sm text-sm text-muted-foreground">
          Your account has no property access. Contact the property owner.
        </p>
        <p v-if="signedInAs" class="mt-4 text-sm text-muted-foreground">
          Signed in as <span class="font-semibold text-foreground">{{ signedInAs }}</span>
        </p>
      </div>

      <template v-else>
        <header class="mb-6">
          <h1 class="text-3xl font-bold tracking-tight sm:text-4xl">Choose a property</h1>
          <p class="mt-2 text-muted-foreground">Select the property you want to manage.</p>
        </header>

        <PropertyPicker
          :properties="accessStore.properties"
          :selected-property-id="accessStore.selectedPropertyId"
          @select="handleSelect"
        />
      </template>
    </div>
  </AppLayout>
</template>
