import { requireUser } from "@/server/auth/context";
import { json, readJson, route } from "@/server/http";
import { simulateDhcpLease } from "@/server/services/dhcp";
import { simulateDhcpLeaseSchema } from "@/server/validation/dhcp";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ scopeId: string }> };

export const POST = route(async (request, context) => {
  const user = await requireUser(request);
  const { scopeId } = await (context as Context).params;
  const input = await readJson(request, simulateDhcpLeaseSchema);
  return json(await simulateDhcpLease(user, scopeId, input), 201);
});
