<script setup lang="ts">
import { SwitchRoot, SwitchThumb } from 'reka-ui'

// An on/off switch: a round thumb, a little larger than its pill track, that slides across and
// fills with the primary colour when on. Label it with a <label for> pointing at `id`.
defineProps<{
  id: string
}>()

const checked = defineModel<boolean>({ required: true })
</script>

<template>
  <SwitchRoot
    :id="id"
    v-model="checked"
    class="switch-track peer relative inline-flex h-5 w-10 shrink-0 cursor-pointer items-center rounded-full bg-input outline-none focus-visible:ring-3 focus-visible:ring-ring/50 data-[state=checked]:bg-primary/30 disabled:cursor-not-allowed disabled:opacity-50"
  >
    <SwitchThumb
      class="switch-thumb grid size-7 place-items-center rounded-full border-[5px] border-muted-foreground/45 bg-background shadow-sm data-[state=checked]:border-primary data-[state=checked]:bg-primary"
    >
      <!-- The darker centre of the "on" thumb. -->
      <span
        class="switch-thumb-core size-full rounded-full bg-foreground/0 data-[state=checked]:bg-foreground/20"
        :data-state="checked ? 'checked' : 'unchecked'"
        aria-hidden="true"
      />
    </SwitchThumb>
  </SwitchRoot>
</template>
