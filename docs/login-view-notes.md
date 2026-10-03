# Overkill Vue Login

This page deliberately **composes existing components** rather than recreating animation components from scratch.

## Components used

- Inspira UI `ParticleWhirlpoolBg` — Three.js + postprocessing
- Inspira UI `CardSpotlight`
- Inspira UI `BorderBeam`
- Inspira UI `ShimmerButton`
- shadcn-vue `Input`
- shadcn-vue `Label`
- `lucide-vue-next` icons

## Install

If Inspira UI/shadcn-vue is not configured yet, follow the current Inspira UI installation guide first:
https://inspira-ui.com/docs/en/getting-started/installation

Core dependencies:

```bash
npm install three postprocessing @vueuse/core motion-v tw-animate-css @inspira-ui/plugins lucide-vue-next
npm install -D @types/three
```

Add the externally maintained components:

```bash
npx shadcn-vue@latest add "https://inspira-ui.com/r/bg-particle-whirlpool.json"
npx shadcn-vue@latest add "https://inspira-ui.com/r/card-spotlight.json"
npx shadcn-vue@latest add "https://inspira-ui.com/r/border-beam.json"
npx shadcn-vue@latest add "https://inspira-ui.com/r/shimmer-button.json"

npx shadcn-vue@latest add input label
```

Then copy `LoginView.vue` into your app, for example:

```text
src/views/auth/LoginView.vue
```

Add a Vue Router route:

```ts
{
  path: "/login",
  name: "login",
  component: () => import("@/views/auth/LoginView.vue"),
}
```

## Wire your real auth

Replace the fake delay inside `submit()`:

```ts
await new Promise((resolve) => setTimeout(resolve, 900))
```

with your existing auth store/API call.

For a Django + DRF backend, this page should only own presentation and submit state. Keep token/cookie handling in your auth service/store rather than stuffing it into the view.

## Performance

The Three.js background is intentionally heavy. If laptops begin sounding like aircraft:

```vue
<ParticleWhirlpoolBg
  :particle-count="1400"
  :blur="1.5"
/>
```

Also consider honoring `prefers-reduced-motion` before shipping to production.
