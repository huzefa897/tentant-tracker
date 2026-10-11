<script setup lang="ts">
import { computed } from 'vue'
import { ArrowLeftRight, ChevronDown, LogOut, User } from '@lucide/vue'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { formatPhoneNumber } from '@/utils/phone'

const props = defineProps<{
  // Empty when nobody has set it in admin: the phone number stands in.
  name: string
  phoneNumber: string
  canSwitchProperty?: boolean
}>()

const emit = defineEmits<{
  'switch-property': []
  logout: []
}>()

const phone = computed(() => (props.phoneNumber ? formatPhoneNumber(props.phoneNumber) : ''))
const displayName = computed(() => props.name.trim() || phone.value || 'Account')

// "Huzefa Saleem" → "HS"; one name gives one letter, no name shows an icon instead.
const initials = computed(() =>
  props.name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join(''),
)
</script>

<!-- Sits on the dark backdrop above the card, so the trigger is light on dark. -->
<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <Button
        variant="ghost"
        class="h-11 max-w-64 gap-2.5 rounded-full pr-3 pl-1 text-white hover:bg-white/10 hover:text-white aria-expanded:bg-white/10"
        aria-label="Account menu"
        data-testid="user-menu-trigger"
      >
        <span
          class="flex size-9 shrink-0 items-center justify-center rounded-full bg-linear-to-br from-[#2a7bff] to-[#0b4fe0] text-sm font-semibold"
          aria-hidden="true"
        >
          <template v-if="initials">{{ initials }}</template>
          <User v-else class="size-5" />
        </span>
        <span class="truncate font-medium" data-testid="user-menu-name">{{ displayName }}</span>
        <ChevronDown class="opacity-80" aria-hidden="true" />
      </Button>
    </DropdownMenuTrigger>

    <DropdownMenuContent align="end" class="w-60 p-1.5">
      <DropdownMenuLabel class="px-2 py-1.5">
        <p class="truncate text-sm font-semibold text-foreground">{{ displayName }}</p>
        <p
          v-if="name.trim() && phone"
          class="truncate text-xs font-normal text-muted-foreground tabular-nums"
        >
          {{ phone }}
        </p>
      </DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        v-if="canSwitchProperty"
        class="h-10 px-2"
        data-testid="user-menu-switch-property"
        @select="emit('switch-property')"
      >
        <ArrowLeftRight aria-hidden="true" />
        Switch property
      </DropdownMenuItem>
      <DropdownMenuItem class="h-10 px-2" data-testid="user-menu-logout" @select="emit('logout')">
        <LogOut aria-hidden="true" />
        Logout
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
