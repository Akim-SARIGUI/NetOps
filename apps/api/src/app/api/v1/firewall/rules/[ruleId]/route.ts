import { requireUser } from "@/server/auth/context";
import { json, route } from "@/server/http";
import { deleteAclRule } from "@/server/services/firewall";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ ruleId: string }> };

export const DELETE = route(async (request, context) => {
  const user = await requireUser(request);
  const { ruleId } = await (context as Context).params;
  return json(await deleteAclRule(user, ruleId));
});
