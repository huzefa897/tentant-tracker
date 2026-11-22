<script setup lang="ts">
import LoadingRegion from '@/components/common/LoadingRegion.vue'
import SkeletonLines from '@/components/common/SkeletonLines.vue'
import { Button } from '@/components/ui/button'
import type { PreviewState } from '@/messaging/useSendMessage'
import type { Tenant } from '@/types/tenant'
import { formatINR } from '@/utils/currency'
import { formatMonthValue } from '@/utils/date'

// Who a dues reminder goes to, every month it covers with what's outstanding, and the text
// they'll get, as the backend would send it now. For the confirm dialog.
defineProps<{
  tenant: Pick<Tenant, 'name' | 'flatNumber'>
  preview: PreviewState
}>()

const emit = defineEmits<{
  retry: []
}>()
</script>

<template>
  <div class="space-y-3">
    <p class="text-sm font-medium">{{ tenant.name }} · Flat {{ tenant.flatNumber }}</p>

    <LoadingRegion
      v-if="preview.status === 'loading'"
      label="Loading what the SMS would say…"
      data-testid="dues-loading"
    >
      <div class="rounded-xl border p-4">
        <SkeletonLines :lines="3" />
      </div>
    </LoadingRegion>

    <div
      v-else-if="preview.status === 'error'"
      class="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm"
      data-testid="dues-error"
    >
      <p class="text-destructive" role="alert">{{ preview.message }}</p>
      <Button variant="outline" size="sm" type="button" @click="emit('retry')">Try again</Button>
    </div>

    <template v-else-if="preview.status === 'ready'">
      <dl class="space-y-1.5 rounded-xl border bg-muted/40 p-4 text-sm" data-testid="dues-months">
        <div
          v-for="month in preview.value.months"
          :key="month.month"
          class="flex justify-between gap-4"
        >
          <dt class="text-muted-foreground">{{ formatMonthValue(month.month) }}</dt>
          <dd class="tabular-nums" :class="month.outstanding === null && 'text-muted-foreground'">
            {{ month.outstanding === null ? 'No bill yet' : formatINR(month.outstanding) }}
          </dd>
        </div>
        <div class="flex justify-between gap-4 border-t pt-1.5 font-semibold">
          <dt>Outstanding on bills</dt>
          <dd class="tabular-nums">{{ formatINR(preview.value.billedOutstanding) }}</dd>
        </div>
      </dl>
      <blockquote
        class="rounded-xl border-l-4 bg-muted/40 px-4 py-3 text-sm text-muted-foreground"
        data-testid="dues-body"
      >
        {{ preview.value.body }}
      </blockquote>
    </template>
  </div>
</template>
