import { requireUser } from "@/server/auth/context";
import { json, readSearchParams, route } from "@/server/http";
import { topologyOverview } from "@/server/services/topology";
import { topologyQuerySchema } from "@/server/validation/topology";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ organizationId: string }> };

export const GET = route(async (request, context) => {
  const user = await requireUser(request);
  const { organizationId } = await (context as Context).params;
  return json(await topologyOverview(user, organizationId, readSearchParams(request, topologyQuerySchema)));
});
