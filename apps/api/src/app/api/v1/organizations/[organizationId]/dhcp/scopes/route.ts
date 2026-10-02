import { requireUser } from "@/server/auth/context";
import { json, readJson, route } from "@/server/http";
import { createDhcpScope } from "@/server/services/dhcp";
import { createDhcpScopeSchema } from "@/server/validation/dhcp";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ organizationId: string }> };

export const POST = route(async (request, context) => {
  const user = await requireUser(request);
  const { organizationId } = await (context as Context).params;
  const input = await readJson(request, createDhcpScopeSchema);
  return json(await createDhcpScope(user, organizationId, input), 201);
});
