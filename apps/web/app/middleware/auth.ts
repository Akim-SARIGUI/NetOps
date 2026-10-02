export default defineNuxtRouteMiddleware(async () => {
  const session = useSession();
  const requestFetch = useRequestFetch();
  try {
    session.value = await requestFetch("/api/backend/auth/me");
  } catch {
    session.value = null;
    return navigateTo("/login");
  }
});
