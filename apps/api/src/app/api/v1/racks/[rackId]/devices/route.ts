import { requireUser } from "@/server/auth/context";
import { json, route } from "@/server/http";
import { listRackDevices } from "@/server/services/inventory";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ rackId: string }> };

export const GET = route(async (request, context) => {
  const user = await requireUser(request);
  const { rackId } = await (context as Context).params;
  return json(await listRackDevices(user, rackId));
});
