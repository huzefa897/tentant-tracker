<script setup lang="ts">
import { RefreshCw } from '@lucide/vue'

import { Button } from '@/components/ui/button'

const props = withDefaults(
  defineProps<{
    error?: string | null
    retryable?: boolean
  }>(),
  { error: null, retryable: true },
)

function reload() {
  window.location.reload()
}
</script>

<template>
  <div class="flex min-h-[60vh] flex-col items-center justify-center gap-6 px-4 text-center">
    <div class="cube-wrapper" aria-hidden="true">
      <div class="cube-container">
        <div class="h1Container">
          <div class="cube h1 w1 l1">
            <div class="face top" />
            <div class="face left" />
            <div class="face right" />
          </div>
          <div class="cube h1 w1 l2">
            <div class="face top" />
            <div class="face left" />
            <div class="face right" />
          </div>
          <div class="cube h1 w1 l3">
            <div class="face top" />
            <div class="face left" />
            <div class="face right" />
          </div>
          <div class="cube h1 w2 l1">
            <div class="face top" />
            <div class="face left" />
            <div class="face right" />
          </div>
          <div class="cube h1 w2 l2">
            <div class="face top" />
            <div class="face left" />
            <div class="face right" />
          </div>
          <div class="cube h1 w2 l3">
            <div class="face top" />
            <div class="face left" />
            <div class="face right" />
          </div>
          <div class="cube h1 w3 l1">
            <div class="face top" />
            <div class="face left" />
            <div class="face right" />
          </div>
          <div class="cube h1 w3 l2">
            <div class="face top" />
            <div class="face left" />
            <div class="face right" />
          </div>
          <div class="cube h1 w3 l3">
            <div class="face top" />
            <div class="face left" />
            <div class="face right" />
          </div>
        </div>
        <div class="h2Container">
          <div class="cube h2 w1 l1">
            <div class="face top" />
            <div class="face left" />
            <div class="face right" />
          </div>
          <div class="cube h2 w1 l2">
            <div class="face top" />
            <div class="face left" />
            <div class="face right" />
          </div>
          <div class="cube h2 w1 l3">
            <div class="face top" />
            <div class="face left" />
            <div class="face right" />
          </div>
          <div class="cube h2 w2 l1">
            <div class="face top" />
            <div class="face left" />
            <div class="face right" />
          </div>
          <div class="cube h2 w2 l2">
            <div class="face top" />
            <div class="face left" />
            <div class="face right" />
          </div>
          <div class="cube h2 w2 l3">
            <div class="face top" />
            <div class="face left" />
            <div class="face right" />
          </div>
          <div class="cube h2 w3 l1">
            <div class="face top" />
            <div class="face left" />
            <div class="face right" />
          </div>
          <div class="cube h2 w3 l2">
            <div class="face top" />
            <div class="face left" />
            <div class="face right" />
          </div>
          <div class="cube h2 w3 l3">
            <div class="face top" />
            <div class="face left" />
            <div class="face right" />
          </div>
        </div>
        <div class="h3Container">
          <div class="cube h3 w1 l1">
            <div class="face top" />
            <div class="face left" />
            <div class="face right" />
          </div>
          <div class="cube h3 w1 l2">
            <div class="face top" />
            <div class="face left" />
            <div class="face right" />
          </div>
          <div class="cube h3 w1 l3">
            <div class="face top" />
            <div class="face left" />
            <div class="face right" />
          </div>
          <div class="cube h3 w2 l1">
            <div class="face top" />
            <div class="face left" />
            <div class="face right" />
          </div>
          <div class="cube h3 w2 l2">
            <div class="face top" />
            <div class="face left" />
            <div class="face right" />
          </div>
          <div class="cube h3 w2 l3">
            <div class="face top" />
            <div class="face left" />
            <div class="face right" />
          </div>
          <div class="cube h3 w3 l1">
            <div class="face top" />
            <div class="face left" />
            <div class="face right" />
          </div>
          <div class="cube h3 w3 l2">
            <div class="face top" />
            <div class="face left" />
            <div class="face right" />
          </div>
          <div class="cube h3 w3 l3">
            <div class="face top" />
            <div class="face left" />
            <div class="face right" />
          </div>
        </div>
      </div>
    </div>

    <div class="space-y-2" role="status" aria-live="polite">
      <p class="text-xl font-bold tracking-tight">
        {{ props.retryable ? "It's taking longer than usual" : 'Something went wrong' }}
      </p>
      <p class="text-sm text-muted-foreground">
        {{
          props.error != null ? props.error : "We're still trying to connect and fetch your data."
        }}
      </p>
      <p v-if="props.retryable" class="text-sm text-muted-foreground">
        Retrying automatically in the background.
      </p>
    </div>

    <Button class="h-11 px-6" @click="reload">
      <RefreshCw class="size-4" aria-hidden="true" />
      Reload
    </Button>
  </div>
</template>

<style scoped>
/* Derived face colors from the app's primary via CSS relative color syntax */
.face.top {
  background: var(--primary);
}
.face.left {
  background: oklch(from var(--primary) calc(l - 0.18) c h);
}
.face.right {
  background: oklch(from var(--primary) calc(l + 0.16) calc(c * 0.55) h);
}

/* The wrapper reserves layout space for the overflowing animation */
.cube-wrapper {
  position: relative;
  width: 175px;
  height: 200px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.cube-container {
  position: relative;
  height: 100px;
  width: 86px;
  transform: scale(0.4);
}

.cube {
  position: absolute;
  width: 86px;
  height: 100px;
  animation-timing-function: ease;
  animation-duration: 3s;
  animation-iteration-count: infinite;
}

.face {
  height: 50px;
  width: 50px;
  position: absolute;
  transform-origin: 0 0;
}

.face.right {
  transform: rotate(-30deg) skewX(-30deg) translate(49px, 65px) scaleY(0.86);
}
.face.left {
  transform: rotate(90deg) skewX(-30deg) scaleY(0.86) translate(25px, -50px);
}
.face.top {
  transform: rotate(210deg) skew(-30deg) translate(-75px, -22px) scaleY(0.86);
  z-index: 2;
}

/* Cube grid position + animation assignment */
.h1.w1.l1 {
  z-index: -1;
  animation-name: h1w1l1;
}
.h1.w1.l2 {
  z-index: -1;
  animation-name: h1w1l2;
}
.h1.w1.l3 {
  z-index: -1;
  animation-name: h1w1l3;
}
.h1.w2.l1 {
  z-index: -1;
  animation-name: h1w2l1;
}
.h1.w2.l2 {
  z-index: -1;
  animation-name: h1w2l2;
}
.h1.w2.l3 {
  z-index: -1;
  animation-name: h1w2l3;
}
.h1.w3.l1 {
  z-index: -1;
  animation-name: h1w3l1;
}
.h1.w3.l2 {
  z-index: -1;
  animation-name: h1w3l2;
}
.h1.w3.l3 {
  z-index: -1;
  animation-name: h1w3l3;
}
.h2.w1.l1 {
  z-index: -2;
  animation-name: h2w1l1;
}
.h2.w1.l2 {
  z-index: -2;
  animation-name: h2w1l2;
}
.h2.w1.l3 {
  z-index: -2;
  animation-name: h2w1l3;
}
.h2.w2.l1 {
  z-index: -2;
  animation-name: h2w2l1;
}
.h2.w2.l2 {
  z-index: -2;
  animation-name: h2w2l2;
}
.h2.w2.l3 {
  z-index: -2;
  animation-name: h2w2l3;
}
.h2.w3.l1 {
  z-index: -2;
  animation-name: h2w3l1;
}
.h2.w3.l2 {
  z-index: -2;
  animation-name: h2w3l2;
}
.h2.w3.l3 {
  z-index: -2;
  animation-name: h2w3l3;
}
.h3.w1.l1 {
  z-index: -3;
  animation-name: h3w1l1;
}
.h3.w1.l2 {
  z-index: -3;
  animation-name: h3w1l2;
}
.h3.w1.l3 {
  z-index: -3;
  animation-name: h3w1l3;
}
.h3.w2.l1 {
  z-index: -3;
  animation-name: h3w2l1;
}
.h3.w2.l2 {
  z-index: -3;
  animation-name: h3w2l2;
}
.h3.w2.l3 {
  z-index: -3;
  animation-name: h3w2l3;
}
.h3.w3.l1 {
  z-index: -3;
  animation-name: h3w3l1;
}
.h3.w3.l2 {
  z-index: -3;
  animation-name: h3w3l2;
}
.h3.w3.l3 {
  z-index: -3;
  animation-name: h3w3l3;
}

/* Keyframes — 27 animations, one per h/w/l combination */
@keyframes h1w1l1 {
  0%,
  85%,
  100% {
    transform: translate(0%, -100%);
  }
  14% {
    transform: translate(-50%, -125%);
  }
  28% {
    transform: translate(0%, -150%);
  }
  43% {
    transform: translate(0%, -200%);
  }
  57% {
    transform: translate(50%, -175%);
  }
  71% {
    transform: translate(0%, -150%);
  }
}
@keyframes h1w1l2 {
  0%,
  85%,
  100% {
    transform: translate(50%, -75%);
  }
  14% {
    transform: translate(50%, -75%);
  }
  28% {
    transform: translate(100%, -100%);
  }
  43% {
    transform: translate(100%, -150%);
  }
  57% {
    transform: translate(100%, -150%);
  }
  71% {
    transform: translate(50%, -125%);
  }
}
@keyframes h1w1l3 {
  0%,
  85%,
  100% {
    transform: translate(100%, -50%);
  }
  14% {
    transform: translate(150%, -25%);
  }
  28% {
    transform: translate(200%, -50%);
  }
  43% {
    transform: translate(200%, -100%);
  }
  57% {
    transform: translate(150%, -125%);
  }
  71% {
    transform: translate(100%, -100%);
  }
}
@keyframes h1w2l1 {
  0%,
  85%,
  100% {
    transform: translate(-50%, -75%);
  }
  14% {
    transform: translate(-100%, -100%);
  }
  28% {
    transform: translate(-100%, -100%);
  }
  43% {
    transform: translate(-100%, -150%);
  }
  57% {
    transform: translate(-50%, -125%);
  }
  71% {
    transform: translate(-50%, -125%);
  }
}
@keyframes h1w2l2 {
  0%,
  85%,
  100% {
    transform: translate(0%, -50%);
  }
  14% {
    transform: translate(0%, -50%);
  }
  28% {
    transform: translate(0%, -50%);
  }
  43% {
    transform: translate(0%, -100%);
  }
  57% {
    transform: translate(0%, -100%);
  }
  71% {
    transform: translate(0%, -100%);
  }
}
@keyframes h1w2l3 {
  0%,
  85%,
  100% {
    transform: translate(50%, -25%);
  }
  14% {
    transform: translate(100%, 0%);
  }
  28% {
    transform: translate(100%, 0%);
  }
  43% {
    transform: translate(100%, -50%);
  }
  57% {
    transform: translate(50%, -75%);
  }
  71% {
    transform: translate(50%, -75%);
  }
}
@keyframes h1w3l1 {
  0%,
  85%,
  100% {
    transform: translate(-100%, -50%);
  }
  14% {
    transform: translate(-150%, -75%);
  }
  28% {
    transform: translate(-200%, -50%);
  }
  43% {
    transform: translate(-200%, -100%);
  }
  57% {
    transform: translate(-150%, -75%);
  }
  71% {
    transform: translate(-100%, -100%);
  }
}
@keyframes h1w3l2 {
  0%,
  85%,
  100% {
    transform: translate(-50%, -25%);
  }
  14% {
    transform: translate(-50%, -25%);
  }
  28% {
    transform: translate(-100%, 0%);
  }
  43% {
    transform: translate(-100%, -50%);
  }
  57% {
    transform: translate(-100%, -50%);
  }
  71% {
    transform: translate(-50%, -75%);
  }
}
@keyframes h1w3l3 {
  0%,
  85%,
  100% {
    transform: translate(0%, 0%);
  }
  14% {
    transform: translate(50%, 25%);
  }
  28% {
    transform: translate(0%, 50%);
  }
  43% {
    transform: translate(0%, 0%);
  }
  57% {
    transform: translate(-50%, -25%);
  }
  71% {
    transform: translate(0%, -50%);
  }
}
@keyframes h2w1l1 {
  0%,
  85%,
  100% {
    transform: translate(0%, -50%);
  }
  14% {
    transform: translate(-50%, -75%);
  }
  28% {
    transform: translate(0%, -100%);
  }
  43% {
    transform: translate(0%, -100%);
  }
  57% {
    transform: translate(50%, -75%);
  }
  71% {
    transform: translate(0%, -50%);
  }
}
@keyframes h2w1l2 {
  0%,
  85%,
  100% {
    transform: translate(50%, -25%);
  }
  14% {
    transform: translate(50%, -25%);
  }
  28% {
    transform: translate(100%, -50%);
  }
  43% {
    transform: translate(100%, -50%);
  }
  57% {
    transform: translate(100%, -50%);
  }
  71% {
    transform: translate(50%, -25%);
  }
}
@keyframes h2w1l3 {
  0%,
  85%,
  100% {
    transform: translate(100%, 0%);
  }
  14% {
    transform: translate(150%, 25%);
  }
  28% {
    transform: translate(200%, 0%);
  }
  43% {
    transform: translate(200%, 0%);
  }
  57% {
    transform: translate(150%, -25%);
  }
  71% {
    transform: translate(100%, 0%);
  }
}
@keyframes h2w2l1 {
  0%,
  85%,
  100% {
    transform: translate(-50%, -25%);
  }
  14% {
    transform: translate(-100%, -50%);
  }
  28% {
    transform: translate(-100%, -50%);
  }
  43% {
    transform: translate(-100%, -50%);
  }
  57% {
    transform: translate(-50%, -25%);
  }
  71% {
    transform: translate(-50%, -25%);
  }
}
@keyframes h2w2l2 {
  0%,
  85%,
  100% {
    transform: translate(0%, 0%);
  }
  14% {
    transform: translate(0%, 0%);
  }
  28% {
    transform: translate(0%, 0%);
  }
  43% {
    transform: translate(0%, 0%);
  }
  57% {
    transform: translate(0%, 0%);
  }
  71% {
    transform: translate(0%, 0%);
  }
}
@keyframes h2w2l3 {
  0%,
  85%,
  100% {
    transform: translate(50%, 25%);
  }
  14% {
    transform: translate(100%, 50%);
  }
  28% {
    transform: translate(100%, 50%);
  }
  43% {
    transform: translate(100%, 50%);
  }
  57% {
    transform: translate(50%, 25%);
  }
  71% {
    transform: translate(50%, 25%);
  }
}
@keyframes h2w3l1 {
  0%,
  85%,
  100% {
    transform: translate(-100%, 0%);
  }
  14% {
    transform: translate(-150%, -25%);
  }
  28% {
    transform: translate(-200%, 0%);
  }
  43% {
    transform: translate(-200%, 0%);
  }
  57% {
    transform: translate(-150%, 25%);
  }
  71% {
    transform: translate(-100%, 0%);
  }
}
@keyframes h2w3l2 {
  0%,
  85%,
  100% {
    transform: translate(-50%, 25%);
  }
  14% {
    transform: translate(-50%, 25%);
  }
  28% {
    transform: translate(-100%, 50%);
  }
  43% {
    transform: translate(-100%, 50%);
  }
  57% {
    transform: translate(-100%, 50%);
  }
  71% {
    transform: translate(-50%, 25%);
  }
}
@keyframes h2w3l3 {
  0%,
  85%,
  100% {
    transform: translate(0%, 50%);
  }
  14% {
    transform: translate(50%, 75%);
  }
  28% {
    transform: translate(0%, 100%);
  }
  43% {
    transform: translate(0%, 100%);
  }
  57% {
    transform: translate(-50%, 75%);
  }
  71% {
    transform: translate(0%, 50%);
  }
}
@keyframes h3w1l1 {
  0%,
  85%,
  100% {
    transform: translate(0%, 0%);
  }
  14% {
    transform: translate(-50%, -25%);
  }
  28% {
    transform: translate(0%, -50%);
  }
  43% {
    transform: translate(0%, 0%);
  }
  57% {
    transform: translate(50%, 25%);
  }
  71% {
    transform: translate(0%, 50%);
  }
}
@keyframes h3w1l2 {
  0%,
  85%,
  100% {
    transform: translate(50%, 25%);
  }
  14% {
    transform: translate(50%, 25%);
  }
  28% {
    transform: translate(100%, 0%);
  }
  43% {
    transform: translate(100%, 50%);
  }
  57% {
    transform: translate(100%, 50%);
  }
  71% {
    transform: translate(50%, 75%);
  }
}
@keyframes h3w1l3 {
  0%,
  85%,
  100% {
    transform: translate(100%, 50%);
  }
  14% {
    transform: translate(150%, 75%);
  }
  28% {
    transform: translate(200%, 50%);
  }
  43% {
    transform: translate(200%, 100%);
  }
  57% {
    transform: translate(150%, 75%);
  }
  71% {
    transform: translate(100%, 100%);
  }
}
@keyframes h3w2l1 {
  0%,
  85%,
  100% {
    transform: translate(-50%, 25%);
  }
  14% {
    transform: translate(-100%, 0%);
  }
  28% {
    transform: translate(-100%, 0%);
  }
  43% {
    transform: translate(-100%, 50%);
  }
  57% {
    transform: translate(-50%, 75%);
  }
  71% {
    transform: translate(-50%, 75%);
  }
}
@keyframes h3w2l2 {
  0%,
  85%,
  100% {
    transform: translate(0%, 50%);
  }
  14% {
    transform: translate(0%, 50%);
  }
  28% {
    transform: translate(0%, 50%);
  }
  43% {
    transform: translate(0%, 100%);
  }
  57% {
    transform: translate(0%, 100%);
  }
  71% {
    transform: translate(0%, 100%);
  }
}
@keyframes h3w2l3 {
  0%,
  85%,
  100% {
    transform: translate(50%, 75%);
  }
  14% {
    transform: translate(100%, 100%);
  }
  28% {
    transform: translate(100%, 100%);
  }
  43% {
    transform: translate(100%, 150%);
  }
  57% {
    transform: translate(50%, 125%);
  }
  71% {
    transform: translate(50%, 125%);
  }
}
@keyframes h3w3l1 {
  0%,
  85%,
  100% {
    transform: translate(-100%, 50%);
  }
  14% {
    transform: translate(-150%, 25%);
  }
  28% {
    transform: translate(-200%, 50%);
  }
  43% {
    transform: translate(-200%, 100%);
  }
  57% {
    transform: translate(-150%, 125%);
  }
  71% {
    transform: translate(-100%, 100%);
  }
}
@keyframes h3w3l2 {
  0%,
  85%,
  100% {
    transform: translate(-50%, 75%);
  }
  14% {
    transform: translate(-50%, 75%);
  }
  28% {
    transform: translate(-100%, 100%);
  }
  43% {
    transform: translate(-100%, 150%);
  }
  57% {
    transform: translate(-100%, 150%);
  }
  71% {
    transform: translate(-50%, 125%);
  }
}
@keyframes h3w3l3 {
  0%,
  85%,
  100% {
    transform: translate(0%, 100%);
  }
  14% {
    transform: translate(50%, 125%);
  }
  28% {
    transform: translate(0%, 150%);
  }
  43% {
    transform: translate(0%, 200%);
  }
  57% {
    transform: translate(-50%, 175%);
  }
  71% {
    transform: translate(0%, 150%);
  }
}

@media (prefers-reduced-motion: reduce) {
  .cube-wrapper {
    display: none;
  }
}
</style>
