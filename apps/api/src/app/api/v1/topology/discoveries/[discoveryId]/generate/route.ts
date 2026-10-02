import { requireUser } from "@/server/auth/context";
import { json, route } from "@/server/http";
import { generateDiscovery } from "@/server/services/topology";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ discoveryId: string }> };

export const POST = route(async (request, context) => {
  const user = await requireUser(request);
  const { discoveryId } = await (context as Context).params;
  return json(await generateDiscovery(user, discoveryId));
});
