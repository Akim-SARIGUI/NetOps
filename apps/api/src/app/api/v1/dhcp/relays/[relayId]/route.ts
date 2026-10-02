import { requireUser } from "@/server/auth/context";
import { json, route } from "@/server/http";
import { deleteDhcpRelay } from "@/server/services/dhcp";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ relayId: string }> };

export const DELETE = route(async (request, context) => {
  const user = await requireUser(request);
  const { relayId } = await (context as Context).params;
  return json(await deleteDhcpRelay(user, relayId));
});