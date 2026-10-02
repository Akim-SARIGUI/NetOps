export default defineNuxtPlugin(() => {
  const { hydrate } = useUiChrome();
  if (import.meta.client) hydrate();
});
