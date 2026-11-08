<script setup lang="ts">
import { House, UserRound, Users, Zap } from '@lucide/vue'
import type { Component } from 'vue'

import type { NavLink, NavSection } from '@/types/nav'

// The app's sections and its Quick entry action. `bar` floats at the bottom of a phone screen;
// `header` is the same links in a row, for wider screens. Each item is a real link; a plain
// click is handed to the parent to navigate in the app, so nothing here knows the router.
const props = defineProps<{
  links: NavLink[]
  current?: NavSection | null
  variant: 'bar' | 'header'
}>()

const emit = defineEmits<{
  navigate: [section: NavSection]
  quickEntry: []
}>()

const ICONS: Record<NavSection, Component> = { home: House, tenants: Users, account: UserRound }

// A click with a modifier (new tab, new window) is left to the browser.
function handleClick(event: MouseEvent, section: NavSection) {
  if (event.defaultPrevented || event.button !== 0) return
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  event.preventDefault()
  emit('navigate', section)
}

// Quick entry sits in the middle of the bar, after the first half of the links.
const half = Math.ceil(props.links.length / 2)
</script>

<template>
  <nav
    v-if="variant === 'bar'"
    aria-label="Main"
    class="glass rounded-full p-1.5 text-card-foreground"
    data-testid="app-nav-bar"
  >
    <ul class="grid grid-flow-col auto-cols-fr items-center gap-1">
      <li v-for="link in links.slice(0, half)" :key="link.section">
        <a
          :href="link.href"
          :aria-current="link.section === current ? 'page' : undefined"
          class="flex h-14 flex-col items-center justify-center gap-0.5 rounded-full text-xs font-medium text-muted-foreground transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 aria-[current=page]:bg-primary/10 aria-[current=page]:text-primary"
          :data-testid="`nav-${link.section}`"
          @click="handleClick($event, link.section)"
        >
          <component :is="ICONS[link.section]" class="size-5" aria-hidden="true" />
          {{ link.label }}
        </a>
      </li>
      <li class="flex justify-center">
        <button
          type="button"
          class="flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[inset_0_1px_0_oklch(1_0_0/0.35),0_6px_16px_-4px_oklch(0.2_0.06_268/0.5)] outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          aria-label="Quick entry"
          data-testid="nav-quick-entry"
          @click="emit('quickEntry')"
        >
          <Zap class="size-6" aria-hidden="true" />
        </button>
      </li>
      <li v-for="link in links.slice(half)" :key="link.section">
        <a
          :href="link.href"
          :aria-current="link.section === current ? 'page' : undefined"
          class="flex h-14 flex-col items-center justify-center gap-0.5 rounded-full text-xs font-medium text-muted-foreground transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 aria-[current=page]:bg-primary/10 aria-[current=page]:text-primary"
          :data-testid="`nav-${link.section}`"
          @click="handleClick($event, link.section)"
        >
          <component :is="ICONS[link.section]" class="size-5" aria-hidden="true" />
          {{ link.label }}
        </a>
      </li>
    </ul>
  </nav>

  <!-- On the dark backdrop above the card: a dark glass pill, light on dark. -->
  <nav
    v-else
    aria-label="Main"
    class="glass-on-dark rounded-full p-1 text-white"
    data-testid="app-nav-header"
  >
    <ul class="flex items-center gap-1">
      <li v-for="link in links" :key="link.section">
        <a
          :href="link.href"
          :aria-current="link.section === current ? 'page' : undefined"
          class="flex h-10 items-center gap-2 rounded-full px-4 text-sm font-medium text-white/80 transition-colors outline-none hover:bg-white/10 hover:text-white focus-visible:ring-3 focus-visible:ring-white/50 aria-[current=page]:bg-white/20 aria-[current=page]:text-white aria-[current=page]:shadow-[inset_0_1px_0_oklch(1_0_0/0.3)]"
          :data-testid="`nav-${link.section}`"
          @click="handleClick($event, link.section)"
        >
          <component :is="ICONS[link.section]" class="size-4" aria-hidden="true" />
          {{ link.label }}
        </a>
      </li>
      <li>
        <button
          type="button"
          class="ml-1 flex h-10 items-center gap-2 rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground shadow-[inset_0_1px_0_oklch(1_0_0/0.35)] outline-none hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-white/50"
          data-testid="nav-quick-entry"
          @click="emit('quickEntry')"
        >
          <Zap class="size-4" aria-hidden="true" />
          Quick entry
        </button>
      </li>
    </ul>
  </nav>
</template>
