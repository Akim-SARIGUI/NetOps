<script setup lang="ts">
const props = withDefaults(
  defineProps<{ name: string; size?: number }>(),
  { size: 18 },
);

const paths: Record<string, string> = {
  layout: "M4 4h7v7H4V4zm9 0h7v4h-7V4zM4 13h7v7H4v-7zm9 2h7v5h-7v-5z",
  gauge: "M12 21a9 9 0 1 1 9-9M12 12l4-2",
  server: "M4 6h16v4H4V6zm0 8h16v4H4v-4zm4 2h.01M8 8h.01",
  cpu: "M9 3v2m6-2v2M9 19v2m6-2v2M3 9h2m14 0h2M3 15h2m14 0h2M7 7h10v10H7V7z",
  layers: "M12 3l9 4.5-9 4.5L3 7.5 12 3zm0 9l9 4.5-9 4.5-9-4.5L12 12z",
  network: "M12 4v4m0 8v4M4 12h4m8 0h4M8.5 8.5l2 2m3 3l2 2m0-7l-2 2m-3 3l-2 2",
  share: "M8 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm8 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8.5 11.5l7 5M15.5 8.5l-7 5",
  globe: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zm0-18c2.5 2.5 4 5.5 4 9s-1.5 6.5-4 9c-2.5-2.5-4-5.5-4-9s1.5-6.5 4-9zm-9 9h18",
  wifi: "M5 12.5a9 9 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 20h.01",
  book: "M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 0-3 3V4zm0 0v16",
  route: "M4 18h6a3 3 0 0 0 0-6H8a3 3 0 0 1 0-6h12M16 6l3 3-3 3",
  shield: "M12 3l8 3v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-3z",
  activity: "M3 12h4l2-6 4 12 2-6h6",
  radar: "M12 12a6 6 0 0 1 6 6M12 12a10 10 0 0 1 10 10M12 12V4m0 8H4",
  stethoscope: "M8 4v6a4 4 0 0 0 8 0V4M6 20a4 4 0 0 0 8 0v-4h2a4 4 0 1 0-1-7.9",
  spark: "M12 3l1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5L12 3z",
  git: "M6 3v18M6 9h8a4 4 0 0 1 0 8H6m10-12v4m0 4v4",
  flask: "M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-9V3",
  file: "M7 3h7l5 5v13H7V3zm7 0v5h5",
  scroll: "M7 4h9a3 3 0 0 1 3 3v11H9a2 2 0 0 0-2 2V4zm0 0v14",
  settings: "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zm8.5 3a7.5 7.5 0 0 0-.2-1.5l2-1.5-2-3.5-2.4 1a7.8 7.8 0 0 0-2.6-1.5L14.5 2h-5l-.8 2.9a7.8 7.8 0 0 0-2.6 1.5l-2.4-1-2 3.5 2 1.5a7.5 7.5 0 0 0 0 3l-2 1.5 2 3.5 2.4-1a7.8 7.8 0 0 0 2.6 1.5l.8 2.9h5l.8-2.9a7.8 7.8 0 0 0 2.6-1.5l2.4 1 2-3.5-2-1.5c.1-.5.2-1 .2-1.5z",
  building: "M4 21V5a2 2 0 0 1 2-2h7v18H4zm11 0V10h5v11h-5zM8 7h2M8 11h2M8 15h2",
  menu: "M4 7h16M4 12h16M4 17h16",
  search: "M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16zm10 2l-4.3-4.3",
  bell: "M12 22a2 2 0 0 0 2-2H10a2 2 0 0 0 2 2zm7-6V11a7 7 0 1 0-14 0v5l-2 2h18l-2-2z",
  sun: "M12 4V2m0 20v-2m8-8h2M2 12h2m13.7-5.7 1.4-1.4M6.9 17.1l-1.4 1.4m12.2 0 1.4 1.4M6.9 6.9 5.5 5.5M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z",
  moon: "M20 14.5A8.5 8.5 0 1 1 9.5 4 7 7 0 0 0 20 14.5z",
  chevron: "M7 10l5 5 5-5",
  help: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zm0-3h.01M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1.5 1-1.5 2.2V14",
  logout: "M10 5H5v14h5M14 12H5m10-5 5 5-5 5",
  plus: "M12 5v14M5 12h14",
  check: "M5 13l4 4L19 7",
  x: "M6 6l12 12M18 6 6 18",
  empty: "M4 7h16v12H4V7zm4-3h8",
};
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path :d="paths[name] || paths.empty" />
  </svg>
</template>
