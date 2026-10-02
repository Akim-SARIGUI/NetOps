import { requireUser } from "@/server/auth/context";
import { json, readJson, route } from "@/server/http";
import { createNetwork } from "@/server/services/ipam";
import { createNetworkSchema } from "@/server/validation/ipam";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ organizationId: string }> };

export const POST = route(async (request, context) => {
  const user = await requireUser(request);
  const { organizationId } = await (context as Context).params;
  const input = await readJson(request, createNetworkSchema);
  return json(await createNetwork(user, organizationId, input), 201);
});
