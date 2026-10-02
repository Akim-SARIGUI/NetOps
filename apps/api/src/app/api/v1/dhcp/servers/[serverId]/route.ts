import { requireUser } from "@/server/auth/context";
import { json, readJson, route } from "@/server/http";
import { deleteDhcpServer, updateDhcpServer } from "@/server/services/dhcp";
import { updateDhcpServerSchema } from "@/server/validation/dhcp";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ serverId: string }> };

export const PATCH = route(async (request, context) => {
  const user = await requireUser(request);
  const { serverId } = await (context as Context).params;
  const input = await readJson(request, updateDhcpServerSchema);
  return json(await updateDhcpServer(user, serverId, input));
});

export const DELETE = route(async (request, context) => {
  const user = await requireUser(request);
  const { serverId } = await (context as Context).params;
  return json(await deleteDhcpServer(user, serverId));
});
