import { requireUser } from "@/server/auth/context";
import { json, readSearchParams, route } from "@/server/http";
import { ipamOverview } from "@/server/services/ipam";
import { ipamQuerySchema } from "@/server/validation/ipam";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ organizationId: string }> };

export const GET = route(async (request, context) => {
  const user = await requireUser(request);
  const { organizationId } = await (context as Context).params;
  const query = readSearchParams(request, ipamQuerySchema);
  return json(await ipamOverview(user, organizationId, query));
});
