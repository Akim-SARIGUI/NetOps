import { requireUser, toSession } from "@/server/auth/context";
import { json, route } from "@/server/http";

export const dynamic = "force-dynamic";

export const GET = route(async (request) => {
  const user = await requireUser(request);
  return json(toSession(user));
});
