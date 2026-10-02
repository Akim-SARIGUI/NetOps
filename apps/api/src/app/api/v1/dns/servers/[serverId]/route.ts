import { requireUser } from "@/server/auth/context";
import { json, readJson, route } from "@/server/http";
import { deleteDnsServer, updateDnsServer } from "@/server/services/dns";
import { updateDnsServerSchema } from "@/server/validation/dns";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ serverId: string }> };

export const PATCH = route(async (request, context) => {
  const user = await requireUser(request);
  const { serverId } = await (context as Context).params;
  const input = await readJson(request, updateDnsServerSchema);
  return json(await updateDnsServer(user, serverId, input));
});

export const DELETE = route(async (request, context) => {
  const user = await requireUser(request);
  const { serverId } = await (context as Context).params;
  return json(await deleteDnsServer(user, serverId));
});
