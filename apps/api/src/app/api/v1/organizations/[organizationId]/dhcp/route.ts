import { requireUser } from "@/server/auth/context";
import { json, readSearchParams, route } from "@/server/http";
import { dhcpOverview } from "@/server/services/dhcp";
import { dhcpQuerySchema } from "@/server/validation/dhcp";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ organizationId: string }> };

export const GET = route(async (request, context) => {
  const user = await requireUser(request);
  const { organizationId } = await (context as Context).params;
  const query = readSearchParams(request, dhcpQuerySchema);
  return json(await dhcpOverview(user, organizationId, query));
});
