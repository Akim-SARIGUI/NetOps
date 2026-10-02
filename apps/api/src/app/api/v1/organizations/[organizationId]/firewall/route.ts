import { requireUser } from "@/server/auth/context";
import { json, readSearchParams, route } from "@/server/http";
import { firewallOverview } from "@/server/services/firewall";
import { firewallQuerySchema } from "@/server/validation/firewall";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ organizationId: string }> };

export const GET = route(async (request, context) => {
  const user = await requireUser(request);
  const { organizationId } = await (context as Context).params;
  return json(await firewallOverview(user, organizationId, readSearchParams(request, firewallQuerySchema)));
});
