import { requireUser } from "@/server/auth/context";
import { json, route } from "@/server/http";
import { deleteFlowRule } from "@/server/services/firewall";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ flowId: string }> };

export const DELETE = route(async (request, context) => {
  const user = await requireUser(request);
  const { flowId } = await (context as Context).params;
  return json(await deleteFlowRule(user, flowId));
});
