import { requireUser } from "@/server/auth/context";
import { automationOverview } from "@/server/services/automation";
import { json, route } from "@/server/http";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ organizationId: string }> };

export const GET = route(async (request, context) => {
  const user = await requireUser(request);
  const { organizationId } = await (context as Context).params;
  return json(await automationOverview(user, organizationId));
});
