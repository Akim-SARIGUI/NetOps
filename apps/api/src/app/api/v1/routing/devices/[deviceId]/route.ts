import { requireUser } from "@/server/auth/context";
import { json, route } from "@/server/http";
import { deviceRoutingTable } from "@/server/services/routing";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ deviceId: string }> };

export const GET = route(async (request, context) => {
  const user = await requireUser(request);
  const { deviceId } = await (context as Context).params;
  return json(await deviceRoutingTable(user, deviceId));
});
