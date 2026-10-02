import { requireUser } from "@/server/auth/context";
import { json, readJson, route } from "@/server/http";
import { deleteDhcpScope, getDhcpScope, updateDhcpScope } from "@/server/services/dhcp";
import { updateDhcpScopeSchema } from "@/server/validation/dhcp";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ scopeId: string }> };

export const GET = route(async (request, context) => {
  const user = await requireUser(request);
  const { scopeId } = await (context as Context).params;
  return json(await getDhcpScope(user, scopeId));
});

export const PATCH = route(async (request, context) => {
  const user = await requireUser(request);
  const { scopeId } = await (context as Context).params;
  const input = await readJson(request, updateDhcpScopeSchema);
  return json(await updateDhcpScope(user, scopeId, input));
});

export const DELETE = route(async (request, context) => {
  const user = await requireUser(request);
  const { scopeId } = await (context as Context).params;
  return json(await deleteDhcpScope(user, scopeId));
});
