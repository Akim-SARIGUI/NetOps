import { requireUser } from "@/server/auth/context";
import { json, route } from "@/server/http";
import { deleteFirewallZone } from "@/server/services/firewall";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ zoneId: string }> };

export const DELETE = route(async (request, context) => {
  const user = await requireUser(request);
  const { zoneId } = await (context as Context).params;
  return json(await deleteFirewallZone(user, zoneId));
});
