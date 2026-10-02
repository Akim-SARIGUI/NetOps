export default defineEventHandler(async () => {
  const config = useRuntimeConfig();
  const api = await $fetch(`${config.apiBase}/api/health`);
  return { web: "ok", api };
});
