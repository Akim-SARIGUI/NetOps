import { deleteCookie } from "h3";

export default defineEventHandler((event) => {
  deleteCookie(event, "netops_token", { path: "/" });
  return { ok: true };
});
