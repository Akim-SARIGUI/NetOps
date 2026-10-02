import { deleteCookie, getCookie, getQuery, getRequestIP, getRouterParam, readBody, setCookie } from "h3";

const COOKIE = "netops_token";

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig();
  const param = getRouterParam(event, "path");
  const path = Array.isArray(param) ? param.join("/") : (param ?? "");
  const method = event.method;
  const token = getCookie(event, COOKIE);

  const headers: Record<string, string> = { accept: "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const source = getRequestIP(event, { xForwardedFor: true });
  if (source) headers["x-forwarded-for"] = source;

  let body: unknown;
  if (method === "POST" || method === "PATCH" || method === "PUT") {
    body = await readBody(event);
  }

  try {
    const response = await $fetch.raw(`${config.apiBase}/api/v1/${path}`, {
      method,
      headers,
      query: getQuery(event),
      body,
    });
    const data = response._data as { token?: string } | null;

    if (path === "auth/login" && method === "POST" && data?.token) {
      setCookie(event, COOKIE, data.token, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 60 * 60 * 8,
      });
      const { token: _token, ...session } = data;
      return session;
    }

    return data;
  } catch (error) {
    const fetchError = error as { statusCode?: number; status?: number; data?: unknown };
    throw createError({
      statusCode: fetchError.statusCode ?? fetchError.status ?? 502,
      statusMessage: "Erreur API",
      data: fetchError.data ?? {
        error: { code: "UPSTREAM", message: "Le backend est injoignable" },
      },
    });
  }
});
