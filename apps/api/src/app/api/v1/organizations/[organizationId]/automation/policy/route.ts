import { requireUser } from "@/server/auth/context";
import { updateAutomationPolicy } from "@/server/services/automation";
import { json, readJson, route } from "@/server/http";
import { updateAutomationPolicySchema } from "@/server/validation/automation";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ organizationId: string }> };

export const PUT = route(async (request, context) => {
  const user = await requireUser(request);
  const { organizationId } = await (context as Context).params;
  return json(await updateAutomationPolicy(user, organizationId, await readJson(request, updateAutomationPolicySchema)));
});
