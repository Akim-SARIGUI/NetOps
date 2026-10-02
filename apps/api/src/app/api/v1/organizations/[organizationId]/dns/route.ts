import { requireUser } from "@/server/auth/context";
import { json, readSearchParams, route } from "@/server/http";
import { dnsOverview } from "@/server/services/dns";
import { dnsQuerySchema } from "@/server/validation/dns";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ organizationId: string }> };

export const GET = route(async (request, context) => {
  const user = await requireUser(request);
  const { organizationId } = await (context as Context).params;
  const query = readSearchParams(request, dnsQuerySchema);
  return json(await dnsOverview(user, organizationId, query));
});
