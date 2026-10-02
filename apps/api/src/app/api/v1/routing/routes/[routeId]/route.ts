import { requireUser } from "@/server/auth/context";
import { json, route } from "@/server/http";
import { deleteRoute } from "@/server/services/routing";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ routeId: string }> };

export const DELETE = route(async (request, context) => {
  const user = await requireUser(request);
  const { routeId } = await (context as Context).params;
  return json(await deleteRoute(user, routeId));
});
