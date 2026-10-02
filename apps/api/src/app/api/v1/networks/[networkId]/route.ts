import { requireUser } from "@/server/auth/context";
import { json, readJson, route } from "@/server/http";
import { deleteNetwork, updateNetwork } from "@/server/services/ipam";
import { updateNetworkSchema } from "@/server/validation/ipam";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ networkId: string }> };

export const PATCH = route(async (request, context) => {
  const user = await requireUser(request);
  const { networkId } = await (context as Context).params;
  const input = await readJson(request, updateNetworkSchema);
  return json(await updateNetwork(user, networkId, input));
});

export const DELETE = route(async (request, context) => {
  const user = await requireUser(request);
  const { networkId } = await (context as Context).params;
  return json(await deleteNetwork(user, networkId));
});
