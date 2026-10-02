import { requireUser } from "@/server/auth/context";
import { json, readJson, route } from "@/server/http";
import { createRoute } from "@/server/services/routing";
import { createRouteSchema } from "@/server/validation/routing";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ organizationId: string }> };

export const POST = route(async (request, context) => {
  const user = await requireUser(request);
  const { organizationId } = await (context as Context).params;
  return json(await createRoute(user, organizationId, await readJson(request, createRouteSchema)), 201);
});
