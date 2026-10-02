import { requireUser } from "@/server/auth/context";
import { json, readJson, route } from "@/server/http";
import { createAclRule } from "@/server/services/firewall";
import { createAclRuleSchema } from "@/server/validation/firewall";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ aclId: string }> };

export const POST = route(async (request, context) => {
  const user = await requireUser(request);
  const { aclId } = await (context as Context).params;
  return json(await createAclRule(user, aclId, await readJson(request, createAclRuleSchema)), 201);
});
