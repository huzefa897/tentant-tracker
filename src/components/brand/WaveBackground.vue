<!-- Decorative backdrop: layered gradient hills over a dark navy sky. -->
<template>
  <svg
    class="pointer-events-none absolute inset-0 h-full w-full"
    viewBox="0 0 1440 1080"
    preserveAspectRatio="xMidYMid slice"
    aria-hidden="true"
  >
    <defs>
      <linearGradient id="wave-sky" x1="0" y1="0" x2="0.4" y2="1">
        <stop offset="0" stop-color="#020f2e" />
        <stop offset="0.55" stop-color="#03215f" />
        <stop offset="1" stop-color="#0841c2" />
      </linearGradient>
      <linearGradient id="wave-center" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#3be3b8" />
        <stop offset="0.35" stop-color="#139bd8" />
        <stop offset="1" stop-color="#0646c8" />
      </linearGradient>
      <linearGradient id="wave-right" x1="0" y1="0" x2="0.3" y2="1">
        <stop offset="0" stop-color="#1fd0f0" />
        <stop offset="0.4" stop-color="#0a6fe0" />
        <stop offset="1" stop-color="#0436b0" />
      </linearGradient>
      <linearGradient id="wave-left" x1="0" y1="0" x2="0.2" y2="1">
        <stop offset="0" stop-color="#c9e8ef" />
        <stop offset="0.3" stop-color="#4fa8d8" />
        <stop offset="1" stop-color="#0b4fcf" />
      </linearGradient>
      <linearGradient id="wave-teal" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#2fd4c4" />
        <stop offset="1" stop-color="#0a5ccc" />
      </linearGradient>
      <linearGradient id="wave-front" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#0a6cf0" />
        <stop offset="1" stop-color="#0332ac" />
      </linearGradient>
      <filter id="wave-soft" x="-5%" y="-5%" width="110%" height="110%">
        <feGaussianBlur stdDeviation="2" />
      </filter>
    </defs>

    <rect width="1440" height="1080" fill="url(#wave-sky)" />

    <g filter="url(#wave-soft)">
      <path
        d="M380 1080 C 520 640 620 220 820 135 C 980 70 1080 200 1200 320 C 1300 420 1380 520 1440 600 L1440 1080 Z"
        fill="url(#wave-center)"
      />
      <path
        d="M760 1080 C 900 760 1060 330 1260 220 C 1340 180 1400 185 1440 195 L1440 1080 Z"
        fill="url(#wave-right)"
        opacity="0.95"
      />
      <path
        d="M0 1080 L0 440 C 40 470 70 520 110 560 C 160 470 250 395 360 382 C 470 370 560 470 640 640 C 700 770 760 920 800 1080 Z"
        fill="url(#wave-left)"
        opacity="0.92"
      />
      <path
        d="M0 1080 L0 450 C 60 500 120 580 200 680 C 280 780 360 900 420 1080 Z"
        fill="url(#wave-teal)"
        opacity="0.85"
      />
      <path
        d="M0 930 C 260 860 420 780 560 800 C 760 830 900 960 1100 960 C 1250 960 1360 880 1440 820 L1440 1080 L0 1080 Z"
        fill="url(#wave-front)"
      />
    </g>
  </svg>
</template>
