export default defineNuxtConfig({
  compatibilityDate: "2026-10-01",
  css: ["~/assets/css/main.css"],
  runtimeConfig: {
    apiBase: "http://127.0.0.1:4000",
  },
  devtools: { enabled: false },
});
