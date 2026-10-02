import { requireUser } from "@/server/auth/context";
import { json, readSearchParams, route } from "@/server/http";
import { routingOverview } from "@/server/services/routing";
import { routingQuerySchema } from "@/server/validation/routing";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ organizationId: string }> };

export const GET = route(async (request, context) => {
  const user = await requireUser(request);
  const { organizationId } = await (context as Context).params;
  return json(await routingOverview(user, organizationId, readSearchParams(request, routingQuerySchema)));
});
